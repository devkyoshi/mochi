import { isIsoDate, recentChanges, type ChangeLine } from "../opsMemory";

const DAY_MS = 86_400_000;

function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

/** Changelog lines from the last `days` days up to and including `today`, newest first. */
export function weekChanges(files: { path: string; content: string }[], today: string, days = 7): ChangeLine[] {
  if (!isIsoDate(today)) return [];
  const end = dayNumber(today);
  return recentChanges(files, 10_000).filter((c) => {
    const age = end - dayNumber(c.date);
    return age >= 0 && age < days;
  });
}

export const DIGEST_SYSTEM = `You write a short weekly digest of infrastructure changes for the person who runs these servers.
- Use only the changelog lines you are given. Never invent facts.
- Plain text, at most 8 short bullet points, grouped by VM or project when that helps, then one line saying what looks worth attention (incidents, many changes to one machine), if anything.
- Never include secret values. You cannot edit files: do not output any <mochi-edit> blocks.`;

/** The request for Claude, or `null` when there is nothing to summarise. */
export function buildDigestRequest(
  changes: ChangeLine[],
  today: string,
): { system: string; messages: { role: "user"; content: string }[] } | null {
  if (changes.length === 0) return null;
  const lines = changes.map((c) => `- ${c.date} — ${c.text}`).join("\n");
  return {
    system: DIGEST_SYSTEM,
    messages: [{ role: "user", content: `Today is ${today}. Changelog lines from the past 7 days:\n${lines}\n\nWrite the weekly digest.` }],
  };
}
