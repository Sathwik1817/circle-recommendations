import { daysSince, type TopicMatch } from "./signals.js";
import type { CircleCandidate, Reason, Strategy } from "./types.js";

/**
 * Member-facing copy. Rules we hold ourselves to:
 *  - Say *why for you*, in plain language, using only things the member can verify
 *    (her own interests, her Circles, visible Circle activity). Never expose raw scores.
 *  - Lead with the personal reason, then proof the Circle is alive, then logistics.
 *  - Never say anything negative about a Circle; ineligible Circles are simply not shown.
 *  - Template-based on purpose: deterministic, zero latency, no hallucination risk.
 *    An LLM could polish tone later, constrained to these same facts (see DESIGN.md).
 */

const FORMAT_LABEL: Record<CircleCandidate["format"], string> = {
  in_person: "Meets in person",
  virtual: "Meets virtually",
  hybrid: "Hybrid (in person + virtual)",
};

export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

export function recencyPhrase(iso: string | null, asOf: string): string {
  const d = Math.floor(daysSince(iso, asOf));
  if (d < 1) return "active today";
  if (d < 2) return "active yesterday";
  if (d < 7) return `active ${d} days ago`;
  return `last active ${d} days ago`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function buildReasons(args: {
  circle: CircleCandidate;
  matches: TopicMatch[];
  coMembers: number;
  health: number;
  strategy: Strategy;
  asOf: string;
}): Reason[] {
  const { circle: c, matches, coMembers, health, strategy, asOf } = args;
  const reasons: Reason[] = [];

  // 1. Personal relevance — the "why you"
  const statedPrimary = matches.filter((m) => m.signal.source === "stated" && m.kind === "primary").map((m) => m.signal.topic.label);
  const statedTag = matches.filter((m) => m.signal.source === "stated" && m.kind === "tag").map((m) => m.signal.topic.label);
  const bio = matches.find((m) => m.signal.source === "bio");
  const viaCircle = matches.find((m) => m.signal.source === "membership");
  const lower = (xs: string[]) => joinList(xs.map((s) => s.toLowerCase()));
  const allStated = [...statedPrimary, ...statedTag];
  if (allStated.length >= 2) {
    const n = allStated.length === 2 ? "two" : String(allStated.length);
    reasons.push({ type: "interest", text: `Covers ${n} of your interests: ${lower(allStated)}.` });
  } else if (statedPrimary.length === 1) {
    reasons.push({ type: "interest", text: `All about ${lower(statedPrimary)}, one of your interests.` });
  } else if (statedTag.length === 1) {
    reasons.push({ type: "interest", text: `Often discusses ${lower(statedTag)}, one of your interests.` });
  } else if (bio) {
    const verb = bio.kind === "primary" ? "Focused on" : "Often discusses";
    reasons.push({ type: "bio", text: `${verb} ${bio.signal.topic.label.toLowerCase()}, which connects to the “${bio.signal.viaPhrase}” in your bio.` });
  } else if (viaCircle?.signal.viaCircle) {
    const lead = viaCircle.kind === "primary" ? "Same focus as" : "Shares themes with";
    reasons.push({ type: "similar_to_your_circle", text: `${lead} ${viaCircle.signal.viaCircle.name}, a Circle you’re already in.` });
  }
  if (coMembers >= 2) {
    reasons.push({ type: "people_you_know", text: `${coMembers} people from your Circles are members here.` });
  }
  if (strategy === "cold_start") {
    const easy = [c.joinPolicy === "open" ? "open to join" : null, c.format !== "in_person" ? "you can take part from anywhere" : null]
      .filter(Boolean) as string[];
    const about = c.topic ? `focused on ${c.topic.label.toLowerCase()}` : "a broad community Circle";
    reasons.push({ type: "welcoming", text: `A great first Circle: ${[about, ...easy].join(", ")}.` });
  } else if (reasons.length === 0) {
    reasons.push({ type: "popular", text: "Something new to explore: one of the most active Circles in the community right now." });
  }

  // 2. Proof of life
  const activity = `${plural(c.posts30d, "post")} and ${plural(c.chat30d, "chat message")} in the last 30 days, ${recencyPhrase(c.lastActivityAt, asOf)}.`;
  reasons.push({ type: "activity", text: health >= 0.7 ? `Very active: ${activity}` : `Active: ${activity}` });

  // 3. Social proof from peers (only when meaningful)
  if (c.membersSharingInterests >= 2) {
    reasons.push({ type: "peers", text: `${c.membersSharingInterests} of ${c.memberCount} members share your interests.` });
  }

  // 4. Leader + logistics
  const leader = c.leaders[0];
  if (leader) {
    reasons.push({ type: "leader", text: `Led by ${leader.firstName}${leader.jobTitle ? `, ${leader.jobTitle}` : ""}.` });
  }
  reasons.push({ type: "availability", text: logistics(c) });
  return reasons;
}

export function logistics(c: CircleCandidate): string {
  const parts = [FORMAT_LABEL[c.format], c.joinPolicy === "open" ? "open to join" : "request to join"];
  if (c.seatsLeft !== null && c.seatsLeft <= 3) parts.push(`only ${plural(c.seatsLeft, "spot")} left`);
  else if (c.seatsLeft !== null) parts.push(`${c.seatsLeft} spots open`);
  return `${parts.join(" · ")}.`;
}

/** The single short sentence shown on the card: personal reason + proof of life. */
export function summarize(reasons: Reason[]): string {
  const personal = reasons.filter((r) => ["interest", "bio", "similar_to_your_circle", "people_you_know", "welcoming", "popular"].includes(r.type));
  const activity = reasons.find((r) => r.type === "activity");
  const peers = reasons.find((r) => r.type === "peers");
  const pieces = [personal[0], activity, peers ?? personal[1]].filter(Boolean) as Reason[];
  return pieces.map((r) => r.text).join(" ");
}
