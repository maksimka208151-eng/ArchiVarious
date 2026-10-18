/** Where a capture was entered. Used for analytics in the algorithm and for debugging sync. */
export type CaptureSource = "plugin" | "widget-desktop" | "widget-mobile" | "uri";

/**
 * Lifecycle of a capture:
 * - `inbox`: just entered, lightly formatted, waiting for its survey time;
 * - `awaiting-survey`: survey is due and has been shown to the user;
 * - `filed`: placed into the vault at its final location.
 */
export type CaptureStatus = "inbox" | "awaiting-survey" | "filed";

export interface Capture {
  id: string;
  /** Raw text exactly as the user typed it. Never mutated, so formatting can be re-run. */
  raw: string;
  /** Lightly formatted body (see `lightFormat`). */
  body: string;
  title: string;
  tags: string[];
  links: string[];
  source: CaptureSource;
  status: CaptureStatus;
  /** ISO-8601 timestamps. Strings rather than Date so captures round-trip through YAML/JSON unchanged. */
  createdAt: string;
  surveyAt: string;
}

/** Short sortable id: base36 timestamp + random suffix. No crypto dependency, works on every platform. */
export function createId(now: Date = new Date(), random: () => number = Math.random): string {
  const suffix = Math.floor(random() * 36 ** 4)
    .toString(36)
    .padStart(4, "0");
  return `${now.getTime().toString(36)}${suffix}`;
}
