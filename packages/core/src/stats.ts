import { readFrontmatter } from "./frontmatter";

/**
 * Statistics and the streak, computed from the vault itself: every capture and filed note carries
 * `created`, filed notes also `filed` and `suggestion_hit` (whether the survey's first suggestion was
 * taken). Both hosts read the same fields, so the numbers match in Obsidian and in the widget app.
 */
export interface ActivityRecord {
  /** Vault path; its folder is the note's section. */
  path: string;
  /** When it was captured (ISO). */
  created?: string;
  /** When it was sorted (ISO). */
  filed?: string;
  /** Whether the user kept the algorithm's first suggestion. */
  hit?: boolean;
}

export interface SectionGrowth {
  folder: string;
  /** Notes captured in this section in the last 7 days. */
  added: number;
}

export interface VaultStats {
  /** Captures per day for the last 7 days, oldest first (index 6 = today). */
  days: { date: string; count: number }[];
  thisWeek: number;
  lastWeek: number;
  /** Share of surveys where the first suggestion was kept, 0–1; null until there are any. */
  accuracy: number | null;
  /** Surveys that count towards `accuracy`. */
  surveys: number;
  /** Sections that got the most new notes in the last 7 days. */
  growing: SectionGrowth[];
  /** Days in a row, up to today, with a capture or a sorted note. Today without activity yet doesn't break it. */
  streak: number;
  bestStreak: number;
  activeToday: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The stats fields of a note, read from its frontmatter. */
export function activityFromNote(path: string, markdown: string): ActivityRecord {
  return activityFromFields(path, readFrontmatter(markdown));
}

/** Same, from fields the host already has (Obsidian's metadata cache). */
export function activityFromFields(path: string, fields: Record<string, unknown>): ActivityRecord {
  const text = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);
  const hit = fields.suggestion_hit;
  return {
    path,
    created: text(fields.created),
    filed: text(fields.filed),
    hit: hit === true || hit === "true" ? true : hit === false || hit === "false" ? false : undefined,
  };
}

export function computeStats(records: ActivityRecord[], now: Date = new Date()): VaultStats {
  const today = startOfDay(now);
  const dayIndex = (iso: string) => Math.round((today - startOfDay(new Date(iso))) / DAY_MS);

  const days = Array.from({ length: 7 }, (_, i) => ({ date: isoDay(new Date(today - (6 - i) * DAY_MS)), count: 0 }));
  let thisWeek = 0;
  let lastWeek = 0;
  let surveys = 0;
  let hits = 0;
  const growth = new Map<string, number>();
  const active = new Set<number>();

  for (const record of records) {
    if (record.created) {
      const ago = dayIndex(record.created);
      active.add(ago);
      if (ago >= 0 && ago < 7) {
        thisWeek++;
        const day = days[6 - ago];
        if (day) day.count++;
        const folder = sectionOf(record.path);
        if (folder) growth.set(folder, (growth.get(folder) ?? 0) + 1);
      } else if (ago >= 7 && ago < 14) {
        lastWeek++;
      }
    }
    if (record.filed) active.add(dayIndex(record.filed));
    if (record.hit !== undefined) {
      surveys++;
      if (record.hit) hits++;
    }
  }

  const activeToday = active.has(0);
  let streak = 0;
  for (let ago = activeToday ? 0 : 1; active.has(ago); ago++) streak++;
  const sorted = [...active].filter((d) => d >= 0).sort((a, b) => a - b);
  let bestStreak = 0;
  let run = 0;
  for (let i = 0; i < sorted.length; i++) {
    run = i > 0 && sorted[i] === (sorted[i - 1] ?? 0) + 1 ? run + 1 : 1;
    bestStreak = Math.max(bestStreak, run);
  }

  const growing = [...growth]
    .map(([folder, added]) => ({ folder, added }))
    .sort((a, b) => b.added - a.added || a.folder.localeCompare(b.folder))
    .slice(0, 3);

  return {
    days,
    thisWeek,
    lastWeek,
    accuracy: surveys > 0 ? hits / surveys : null,
    surveys,
    growing,
    streak,
    bestStreak,
    activeToday,
  };
}

/** A note's section: its folder; inbox captures and root notes have none yet. */
function sectionOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
