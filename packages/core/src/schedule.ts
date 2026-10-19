export interface SurveyPolicy {
  /** Delay before the first survey, in minutes. Long enough for context to settle, short enough to still remember why. */
  delayMinutes: number;
  /** If the user skips a survey, ask again after this many minutes. */
  snoozeMinutes: number;
  /** Do not interrupt during these local hours (e.g. 23 → 8). */
  quietHours?: { from: number; to: number };
}

export const DEFAULT_SURVEY_POLICY: SurveyPolicy = {
  delayMinutes: 6 * 60,
  snoozeMinutes: 60,
  quietHours: { from: 23, to: 8 },
};

export function scheduleSurvey(createdAt: Date, policy: SurveyPolicy = DEFAULT_SURVEY_POLICY): Date {
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
  if (!quiet || !inQuietHours(date.getHours(), quiet)) return date;
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
