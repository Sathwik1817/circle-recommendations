import { CONFIG } from "./config.js";
import type { CircleCandidate, ExclusionReason, TopicSignal, UserContext } from "./types.js";

const DAY = 86_400_000;
const saturate = (x: number, scale: number) => 1 - Math.exp(-Math.max(0, x) / scale);

export function daysSince(iso: string | null, asOf: string): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return Math.max(0, (Date.parse(asOf) - Date.parse(iso)) / DAY);
}

/**
 * Hard eligibility rules. These are product rules, not preferences: recommending a full or
 * dead Circle to someone looking for support is a broken promise, no matter how well it matches.
 */
export function exclusionReasons(c: CircleCandidate, user: UserContext, asOf: string): ExclusionReason[] {
  const out: ExclusionReason[] = [];
  if (user.memberCircleIds.has(c.id)) out.push("already_member");
  if (c.isFull) out.push("full");
  if (isInactive(c, asOf)) out.push("inactive");
  if (c.access !== "public") out.push("not_discoverable"); // unlisted = invite/link only, never surfaced
  return out;
}

/** Identity/affinity Circle (or topic-less community Circle) — see CONFIG.identityTopics. */
export function isIdentityCircle(c: CircleCandidate): boolean {
  return c.topic === null || CONFIG.identityTopics.includes(c.topic.slug);
}

/**
 * Identity Circles need an explicit opt-in: a stated interest in that exact topic.
 * Topic-less Circles can't be matched on interest at all, so the only honest reason to show one
 * is social proof — people she already shares a Circle with are members.
 */
export function hasExplicitOptIn(c: CircleCandidate, user: UserContext): boolean {
  if (c.topic) return user.statedTopicIds.has(c.topic.id);
  return (user.coMemberCounts.get(c.id) ?? 0) >= CONFIG.minCoMembers;
}

export function isInactive(c: CircleCandidate, asOf: string): boolean {
  if (daysSince(c.lastActivityAt, asOf) > CONFIG.inactiveAfterDays) return true;
  return c.posts30d < CONFIG.minPosts30d && c.chat30d < CONFIG.minChat30d;
}

/** 0..1 — is this Circle alive right now? Blends volume, conversation, engagement and recency. */
export function healthScore(c: CircleCandidate, asOf: string): number {
  const posts = saturate(c.posts30d, CONFIG.posts30dScale);
  const chat = saturate(c.chat30d, CONFIG.chat30dScale);
  const engagement = saturate(c.engagementPerPost30d, CONFIG.engagementScale);
  const recency = Math.pow(0.5, daysSince(c.lastActivityAt, asOf) / CONFIG.recencyHalfLifeDays);
  return 0.35 * posts + 0.25 * chat + 0.15 * engagement + 0.25 * recency;
}

export interface TopicMatch {
  signal: TopicSignal;
  kind: "primary" | "tag";
  strength: number;
}

/** 0..1 — how well does this Circle's topic/tags line up with what we know the member cares about? */
export function relevance(c: CircleCandidate, user: UserContext): { score: number; matches: TopicMatch[]; coMembers: number } {
  const matches: TopicMatch[] = [];
  const identity = isIdentityCircle(c);
  for (const s of user.topicSignals) {
    if (identity && s.source !== "stated") continue; // never infer identity topics
    if (c.topic?.id === s.topic.id) matches.push({ signal: s, kind: "primary", strength: s.weight * CONFIG.primaryTopicMatch });
    else if (!identity && c.tags.some((t) => t.id === s.topic.id)) matches.push({ signal: s, kind: "tag", strength: s.weight * CONFIG.tagOnlyMatch });
  }
  matches.sort((a, b) => b.strength - a.strength);
  const topicScore = matches.length === 0
    ? 0
    : matches[0]!.strength + CONFIG.secondaryMatchBonus * matches.slice(1).reduce((sum, m) => sum + m.strength, 0);

  // Co-membership: share of this Circle's members the user already knows from her own Circles.
  const rawCo = user.coMemberCounts.get(c.id) ?? 0;
  const coMembers = rawCo >= CONFIG.minCoMembers ? rawCo : 0;
  const coScore = c.memberCount > 0 && coMembers > 0 ? Math.min(CONFIG.coMembershipCap, (2 * coMembers) / c.memberCount) : 0;

  return { score: Math.min(1, Math.max(topicScore, coScore) + 0.1 * Math.min(topicScore, coScore)), matches, coMembers };
}

/** 0..1 — share of members who share at least one of the user's stated interests. */
export function peerFit(c: CircleCandidate): number {
  return c.memberCount > 0 ? Math.min(1, c.membersSharingInterests / c.memberCount) : 0;
}

/** 0..1 — room to join. Uncapped = 1; last couple of seats are still fine, just less slack. */
export function availability(c: CircleCandidate): number {
  if (c.seatsLeft === null) return 1;
  if (c.seatsLeft <= 0) return 0;
  return Math.min(1, 0.6 + 0.1 * c.seatsLeft);
}

/** 0..1 — signals a newcomer will feel welcome: open to join, has a description, a cover, a visible leader. */
export function welcomeScore(c: CircleCandidate): number {
  return (
    0.4 * (c.joinPolicy === "open" ? 1 : 0) +
    0.2 * (c.description ? 1 : 0) +
    0.15 * (c.coverImageUrl ? 1 : 0) +
    0.25 * (c.leaders.length > 0 ? 1 : 0)
  );
}

/**
 * 0..1 — can she actually attend? Circles carry no location in this dataset, so we can't geo-match
 * (see DESIGN.md). What we can say: in-person-only is a poor fit for someone who lists herself as
 * Remote, and an uncertain one when we don't know where she is. Virtual/hybrid work for anyone.
 */
export function formatFit(c: CircleCandidate, user: UserContext): number {
  if (c.format !== "in_person") return 1;
  const loc = user.location?.trim().toLowerCase();
  if (loc === "remote") return 0.3;
  if (!loc) return 0.6;
  return 1;
}
