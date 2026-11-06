export interface TopicRef {
  id: number;
  slug: string;
  label: string;
}

/** Where a topic signal for the user came from. Ordered by how much we trust it. */
export type TopicSource = "stated" | "bio" | "membership";

export interface TopicSignal {
  topic: TopicRef;
  source: TopicSource;
  weight: number; // 0..1
  /** For membership-derived signals: the Circle the user is already in. */
  viaCircle?: { id: number; name: string };
  /** For bio-derived signals: the phrase that triggered it. */
  viaPhrase?: string;
}

export interface UserContext {
  id: number;
  firstName: string;
  location: string | null;
  bio: string | null;
  joinedAt: string;
  profileCompleteness: number;
  statedTopicIds: Set<number>;
  memberCircleIds: Set<number>;
  topicSignals: TopicSignal[];
  /** circle_id -> number of distinct people the user already shares a Circle with who are members. */
  coMemberCounts: Map<number, number>;
}

export interface LeaderRef {
  firstName: string;
  jobTitle: string | null;
}

export interface CircleCandidate {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  coverImageUrl: string | null;
  topic: TopicRef | null;
  tags: TopicRef[];
  format: "in_person" | "virtual" | "hybrid";
  access: "public" | "unlisted";
  joinPolicy: "open" | "request";
  maxMembers: number | null;
  memberCount: number;
  seatsLeft: number | null;
  isFull: boolean;
  createdAt: string;
  lastActivityAt: string | null;
  posts30d: number;
  chat30d: number;
  /** Mean (reactions + comments + saves) per post over the last 30 days. */
  engagementPerPost30d: number;
  leaders: LeaderRef[];
  /** Members who share at least one of the requesting user's stated interests. */
  membersSharingInterests: number;
}

export type ExclusionReason = "already_member" | "full" | "inactive" | "not_discoverable" | "needs_explicit_interest" | "similar_to_joined";

export interface ScoreBreakdown {
  relevance: number;
  health: number;
  peerFit: number;
  availability: number;
  welcome: number;
  formatFit: number;
  total: number;
}

export interface Reason {
  type: "interest" | "bio" | "similar_to_your_circle" | "people_you_know" | "peers" | "activity" | "availability" | "leader" | "welcoming" | "popular";
  text: string;
}

export interface ScoredCircle {
  circle: CircleCandidate;
  score: ScoreBreakdown;
  reasons: Reason[];
  /** True when the Circle matched one of her topic signals (vs. social proof / popularity only). */
  topicMatched?: boolean;
}

export type Strategy = "personalized" | "inferred" | "cold_start";
