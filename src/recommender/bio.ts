import type { TopicRef } from "./types.js";

/**
 * Tiny, transparent keyword → topic map for free-text bios.
 *
 * Deliberately conservative: a false positive here puts an irrelevant Circle in front of a
 * member, which costs more trust than a missed match. In production this is where an
 * embedding / LLM classifier over bio + job title would go (offline, cached per profile edit).
 */
const RULES: { pattern: RegExp; slug: string }[] = [
  { pattern: /\bleader(ship)?s?\b|\bleadership role\b/i, slug: "leadership-skills" },
  { pattern: /\b(first[- ]time|new) manager\b|\bmanaging (a|my) team\b/i, slug: "managing-a-team" },
  { pattern: /\bmentor(ing|ship|s)?\b|\bsponsor(ship|s)?\b/i, slug: "sponsorship-mentorship" },
  { pattern: /\bcareer break\b|\breturn(ing)? to work\b/i, slug: "career-breaks" },
  { pattern: /\bnegotiat\w*|\bpay equity\b|\bcomp(ensation)? conversation\b|\bsalary\b/i, slug: "negotiation" },
  { pattern: /\bpromot(ed|ion)\b|\bnext level\b/i, slug: "getting-promoted" },
  { pattern: /\bconfiden(ce|t)\b/i, slug: "confidence" },
  { pattern: /\bimposter\b/i, slug: "imposter-syndrome" },
  { pattern: /\bburn(ed)? ?out\b|\bstress\b/i, slug: "stress-burnout" },
  { pattern: /\bpublic speaking\b|\bexecutive presence\b|\bpresenting\b/i, slug: "public-speaking" },
  { pattern: /\bfeedback\b/i, slug: "giving-feedback" },
  { pattern: /\bnetworking\b/i, slug: "networking" },
  { pattern: /\bworking (mom|mother)\b|\bmotherhood\b/i, slug: "working-motherhood" },
];

export function inferTopicsFromBio(bio: string | null, topics: TopicRef[]): { topic: TopicRef; phrase: string }[] {
  if (!bio) return [];
  const bySlug = new Map(topics.map((t) => [t.slug, t]));
  const out: { topic: TopicRef; phrase: string }[] = [];
  for (const rule of RULES) {
    const m = bio.match(rule.pattern);
    const topic = bySlug.get(rule.slug);
    if (m && topic && !out.some((o) => o.topic.id === topic.id)) out.push({ topic, phrase: m[0].toLowerCase() });
  }
  return out;
}
