import { CONFIG } from "./config.js";
import { diversify, isNearDuplicate } from "./diversify.js";
import { buildReasons, summarize } from "./explain.js";
import type { Repository } from "./repository.js";
import {
  availability, exclusionReasons, formatFit, hasExplicitOptIn, isIdentityCircle, healthScore, peerFit, relevance, welcomeScore,
} from "./signals.js";
import type { CircleCandidate, ExclusionReason, ScoredCircle, Strategy, UserContext } from "./types.js";

export interface RecommendOptions {
  limit?: number;
  asOf?: string;
  debug?: boolean;
}

export interface RecommendationDTO {
  rank: number;
  circle: {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    topic: { slug: string; label: string } | null;
    format: CircleCandidate["format"];
    join_policy: CircleCandidate["joinPolicy"];
    member_count: number;
    max_members: number | null;
    seats_left: number | null;
    cover_image_url: string | null;
    leader: { first_name: string; job_title: string | null } | null;
  };
  match_type: "match" | "explore";
  explanation: string;
  reasons: { type: string; text: string }[];
  similar_circles: { id: number; name: string }[];
  score?: Record<string, number>;
}

export interface RecommendationResponse {
  user: { id: number; first_name: string };
  strategy: Strategy;
  as_of: string;
  recommendations: RecommendationDTO[];
  tips: string[];
  debug?: {
    weights: Record<string, number>;
    user_signals: { topic: string; source: string; weight: number }[];
    excluded: { circle_id: number; name: string; reasons: ExclusionReason[] }[];
    ranked_before_diversity: { circle_id: number; name: string; total: number }[];
  };
}

export function pickStrategy(user: UserContext): Strategy {
  if (user.statedTopicIds.size > 0) return "personalized";
  if (user.topicSignals.length > 0 || user.coMemberCounts.size > 0) return "inferred";
  return "cold_start";
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export class Recommender {
  constructor(private readonly repo: Repository) {}

  recommend(userId: number, opts: RecommendOptions = {}): RecommendationResponse | null {
    const user = this.repo.loadUser(userId);
    if (!user) return null;
    const asOf = opts.asOf ?? process.env.AS_OF ?? this.repo.dataClock();
    const limit = Math.min(Math.max(1, opts.limit ?? CONFIG.defaultLimit), CONFIG.maxLimit);
    const strategy = pickStrategy(user);
    const weights = strategy === "cold_start" ? CONFIG.coldStartWeights : CONFIG.personalizedWeights;

    const candidates = this.repo.loadCandidates(user, asOf);
    const joined = candidates.filter((c) => user.memberCircleIds.has(c.id));
    const excluded: NonNullable<RecommendationResponse["debug"]>["excluded"] = [];
    const scored: ScoredCircle[] = [];

    for (const c of candidates) {
      const why = exclusionReasons(c, user, asOf);
      if (isIdentityCircle(c) && !hasExplicitOptIn(c, user)) why.push("needs_explicit_interest");
      // She's already in a near-identical Circle; a second copy is noise, not a new opportunity.
      if (!why.includes("already_member") && joined.some((j) => isNearDuplicate(j, c))) why.push("similar_to_joined");
      if (why.length) { excluded.push({ circle_id: c.id, name: c.name, reasons: why }); continue; }

      const rel = relevance(c, user);
      const parts = {
        relevance: rel.score,
        health: healthScore(c, asOf),
        peerFit: peerFit(c),
        availability: availability(c),
        welcome: welcomeScore(c),
        formatFit: formatFit(c, user),
      };
      const total = (Object.keys(weights) as (keyof typeof weights)[]).reduce((s, k) => s + weights[k] * parts[k], 0);
      scored.push({
        circle: c,
        score: { ...parts, total },
        reasons: buildReasons({ circle: c, matches: rel.matches, coMembers: rel.coMembers, health: parts.health, strategy, asOf }),
        topicMatched: rel.matches.length > 0,
      });
    }

    const ranked = diversify(scored, limit);
    const tips: string[] = [];
    if (strategy !== "personalized") {
      tips.push("Pick a few topics you care about in your profile and we’ll tailor these picks to your goals.");
    }
    if (user.profileCompleteness < 0.6) {
      tips.push("Members with a photo and a short bio get a warmer welcome when they join a Circle.");
    }

    const response: RecommendationResponse = {
      user: { id: user.id, first_name: user.firstName },
      strategy,
      as_of: asOf,
      recommendations: ranked.map((r, i) => {
        const c = r.circle;
        const leader = c.leaders[0];
        const dto: RecommendationDTO = {
          rank: i + 1,
          circle: {
            id: c.id, name: c.name, slug: c.slug, description: c.description,
            topic: c.topic ? { slug: c.topic.slug, label: c.topic.label } : null,
            format: c.format, join_policy: c.joinPolicy, member_count: c.memberCount, max_members: c.maxMembers,
            seats_left: c.seatsLeft, cover_image_url: c.coverImageUrl,
            leader: leader ? { first_name: leader.firstName, job_title: leader.jobTitle } : null,
          },
          match_type: r.topicMatched ? "match" : "explore",
          explanation: summarize(r.reasons),
          reasons: r.reasons,
          similar_circles: r.similar.map((s) => ({ id: s.id, name: s.name })),
        };
        if (opts.debug) {
          dto.score = Object.fromEntries(
            Object.entries({ ...r.score, diversified: r.diversifiedScore }).map(([k, v]) => [k, round(v)]),
          );
        }
        return dto;
      }),
      tips,
    };

    if (opts.debug) {
      response.debug = {
        weights: { ...weights },
        user_signals: user.topicSignals.map((s) => ({ topic: s.topic.slug, source: s.source, weight: s.weight })),
        excluded,
        ranked_before_diversity: [...scored]
          .sort((a, b) => b.score.total - a.score.total)
          .slice(0, 10)
          .map((s) => ({ circle_id: s.circle.id, name: s.circle.name, total: round(s.score.total) })),
      };
    }
    return response;
  }
}
