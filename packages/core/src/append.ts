/**
 * "Add to a note": a new capture can be appended to an existing note instead of becoming a file of its own.
 * Each entry gets a dated heading, so the note still reads as a log of what was added and when.
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** One entry as Markdown: a heading with the date and time, then the text. */
export function entryBlock(entry: string, when: Date): string {
  const stamp = `${pad(when.getDate())}.${pad(when.getMonth() + 1)}.${when.getFullYear()} ${pad(when.getHours())}:${pad(when.getMinutes())}`;
  return `### ${stamp}\n\n${entry.trim()}\n`;
}

/** The whole note after the entry is added at its end, with a blank line before the new heading. */
export function appendEntry(existing: string, entry: string, when: Date): string {
  const body = existing.trimEnd();
  return body ? `${body}\n\n${entryBlock(entry, when)}` : entryBlock(entry, when);
}
