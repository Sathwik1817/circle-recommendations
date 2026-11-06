import { CONFIG } from "./config.js";
import type { CircleCandidate, ScoredCircle } from "./types.js";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "of", "to", "for", "at", "in", "with", "who", "like", "&",
  "circle", "circles", "women", "woman", "collective", "lab", "room", "club", "group", "guild",
]);

/** Crude-but-explainable name stems: lowercase content words, first 5 chars ("negotiation" ≈ "negotiate"). */
export function nameStems(name: string): Set<string> {
  return new Set(
    name.toLowerCase().split(/[^a-z0-9&]+/).filter((w) => w.length >= 4 && !STOPWORDS.has(w)).map((w) => w.slice(0, 5)),
  );
}

/**
 * Two Circles are near-duplicates if they share a primary topic AND their names share a stem
 * ("Negotiation Circle" / "The Negotiation Table" / "Negotiate Like a Leader").
 * Same-topic Circles with distinct identities ("Women Who Lead" vs "Board-Ready Women") are NOT
 * duplicates — they're handled by the softer topic-diversity penalty instead.
 * Production version: cosine similarity over name+description embeddings (see DESIGN.md).
 */
export function isNearDuplicate(a: CircleCandidate, b: CircleCandidate): boolean {
  if (!a.topic || !b.topic || a.topic.id !== b.topic.id) return false;
  const sa = nameStems(a.name);
  for (const s of nameStems(b.name)) if (sa.has(s)) return true;
  return false;
}

export interface DiversifiedResult extends ScoredCircle {
  similar: CircleCandidate[];
  diversifiedScore: number;
}

/**
 * Greedy re-rank:
 *  1. Walk candidates best-first; a near-duplicate of something already chosen is folded into
 *     that pick's `similar` list (so the member still sees the option) instead of taking a slot.
 *  2. Each slot is filled by the best remaining score after a multiplicative penalty for every
 *     already-chosen Circle on the same topic — so a list spans the member's interests.
 */
export function diversify(scored: ScoredCircle[], limit: number): DiversifiedResult[] {
  const pool = [...scored].sort((a, b) => b.score.total - a.score.total);
  const picked: DiversifiedResult[] = [];

  while (picked.length < limit && pool.length > 0) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i]!;
      const dupOf = picked.find((p) => isNearDuplicate(p.circle, cand.circle));
      if (dupOf) {
        dupOf.similar.push(cand.circle);
        pool.splice(i, 1);
        i--;
        continue;
      }
      const sameTopic = cand.circle.topic
        ? picked.filter((p) => p.circle.topic?.id === cand.circle.topic!.id).length
        : 0;
      const s = cand.score.total * Math.pow(CONFIG.sameTopicDecay, sameTopic);
      if (s > bestScore) { bestScore = s; bestIdx = i; }
    }
    if (bestIdx < 0) break;
    const [chosen] = pool.splice(bestIdx, 1);
    picked.push({ ...chosen!, similar: [], diversifiedScore: bestScore });
  }

  // Fold any remaining near-duplicates of picked Circles into their `similar` lists too.
  for (const cand of pool) {
    const dupOf = picked.find((p) => isNearDuplicate(p.circle, cand.circle));
    if (dupOf) dupOf.similar.push(cand.circle);
  }
  return picked;
}
