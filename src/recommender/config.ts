/**
 * Every tunable in one place, so the ranking is explainable and easy to A/B later.
 * Values were hand-tuned against the planted scenarios + an all-users sanity pass (see tests/).
 */
export const CONFIG = {
  /** A Circle with no feed/chat activity for this long is treated as dormant and never recommended. */
  inactiveAfterDays: 45,
  /** …or if it has essentially no activity in the last 30 days. */
  minPosts30d: 1,
  minChat30d: 5,

  /** Final blend for members we know something about (stated, bio or membership signals). */
  personalizedWeights: { relevance: 0.55, health: 0.25, peerFit: 0.08, availability: 0.05, welcome: 0.02, formatFit: 0.05 },
  /** Cold start: nothing to match on, so rank on "a great first Circle" qualities. */
  coldStartWeights: { relevance: 0, health: 0.5, peerFit: 0, availability: 0.1, welcome: 0.25, formatFit: 0.15 },

  /** Topic matching strengths. */
  primaryTopicMatch: 1.0,
  tagOnlyMatch: 0.5,
  /** Extra credit for each additional user topic the same Circle covers. */
  secondaryMatchBonus: 0.25,
  /** Co-membership ("people from your Circles are here") contribution cap. */
  coMembershipCap: 0.25,
  /** Need at least this many shared people before co-membership counts (1 is noise). */
  minCoMembers: 2,

  /** Activity saturation scales (value at which a component reaches ~63% of max). */
  posts30dScale: 8,
  chat30dScale: 80,
  engagementScale: 10,
  recencyHalfLifeDays: 10,

  /** Diversity re-ranking: each already-picked Circle on the same topic multiplies the score by this. */
  sameTopicDecay: 0.7,

  /**
   * Identity/affinity-based topics. We only recommend these Circles when the member explicitly chose
   * the topic — never inferred from tags, bios or popularity. Guessing someone is a mother, or "the
   * only one" in her workplace, is presumptuous at best. Circles with no topic (often community or
   * regional groups, e.g. "Women of the 405") are only shown when people she knows are in them.
   */
  identityTopics: ["working-motherhood", "being-the-only-one"] as readonly string[],

  defaultLimit: 5,
  maxLimit: 20,
} as const;
