export interface SurveyPolicy {
  /** Delay before the first survey, in minutes. Long enough for context to settle, short enough to still remember why. */
  delayMinutes: number;
  /** If the user skips a survey, ask again after this many minutes. */
  snoozeMinutes: number;
  /** Do not interrupt during these local hours (e.g. 23 → 8). Equal hours turn quiet hours off. */
  quietHours?: { from: number; to: number };
  /**
   * Ask at a fixed time of day instead of after a delay: `"21:00"` = the next 21:00 after the capture
   * (but at least `minMinutes` later, so a note taken at 20:59 is not asked about a minute later).
   */
  at?: string;
}

/** A capture made shortly before the fixed survey time waits for the next day's survey. */
const MIN_MINUTES_BEFORE_FIXED_SURVEY = 30;

/** `"21:00"` → `{ hour: 21, minute: 0 }`; anything else → null. */
export function parseClock(value: string | undefined): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

export const DEFAULT_SURVEY_POLICY: SurveyPolicy = {
  delayMinutes: 6 * 60,
  snoozeMinutes: 60,
  quietHours: { from: 23, to: 8 },
};

export function scheduleSurvey(createdAt: Date, policy: SurveyPolicy = DEFAULT_SURVEY_POLICY): Date {
  const clock = parseClock(policy.at);
  if (clock) {
    const at = new Date(createdAt);
    at.setHours(clock.hour, clock.minute, 0, 0);
    if (at.getTime() < addMinutes(createdAt, MIN_MINUTES_BEFORE_FIXED_SURVEY).getTime()) at.setDate(at.getDate() + 1);
    // A time the user chose on purpose is not moved by quiet hours.
    return at;
  }
  return avoidQuietHours(addMinutes(createdAt, policy.delayMinutes), policy);
}

export function snoozeSurvey(now: Date, policy: SurveyPolicy = DEFAULT_SURVEY_POLICY): Date {
  return avoidQuietHours(addMinutes(now, policy.snoozeMinutes), policy);
}

export function isSurveyDue(surveyAt: string | Date, now: Date = new Date()): boolean {
  return new Date(surveyAt).getTime() <= now.getTime();
}

function avoidQuietHours(date: Date, policy: SurveyPolicy): Date {
  const quiet = policy.quietHours;
  if (!quiet || quiet.from === quiet.to || !inQuietHours(date.getHours(), quiet)) return date;
  const shifted = new Date(date);
  if (date.getHours() >= quiet.to) shifted.setDate(shifted.getDate() + 1);
  shifted.setHours(quiet.to, 0, 0, 0);
  return shifted;
}

function inQuietHours(hour: number, { from, to }: { from: number; to: number }): boolean {
  return from > to ? hour >= from || hour < to : hour >= from && hour < to;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Days after filing before a note comes back for a review survey ("does it still belong here?"). */
export const DEFAULT_REVIEW_DAYS = 7;

export function scheduleReview(from: Date, days: number): Date {
  return addMinutes(from, days * 24 * 60);
}

/**
 * Spaced reviews: every filed note is reviewed once; notes marked important (3) keep coming back
 * at doubling intervals, the way spaced repetition resurfaces what matters. `null` = no more reviews.
 */
export function nextReviewDays(previousDays: number, importance: 1 | 2 | 3): number | null {
  return importance === 3 ? Math.max(1, previousDays) * 2 : null;
}
