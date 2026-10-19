import { describe, expect, it } from "vitest";
import { isSurveyDue, nextReviewDays, scheduleReview, scheduleSurvey, snoozeSurvey } from "../src/schedule";

const policy = { delayMinutes: 120, snoozeMinutes: 30, quietHours: { from: 23, to: 8 } };

describe("survey scheduling", () => {
  it("schedules after the configured delay", () => {
    const at = scheduleSurvey(new Date(2026, 0, 1, 10, 0), policy);
    expect(at).toEqual(new Date(2026, 0, 1, 12, 0));
  });

  it("moves surveys out of quiet hours to the next morning", () => {
    expect(scheduleSurvey(new Date(2026, 0, 1, 22, 0), policy)).toEqual(new Date(2026, 0, 2, 8, 0));
    expect(scheduleSurvey(new Date(2026, 0, 2, 1, 0), policy)).toEqual(new Date(2026, 0, 2, 8, 0));
  });

  it("snoozes and reports due surveys", () => {
    const now = new Date(2026, 0, 1, 15, 0);
    expect(snoozeSurvey(now, policy)).toEqual(new Date(2026, 0, 1, 15, 30));
    expect(isSurveyDue(new Date(2026, 0, 1, 14, 59), now)).toBe(true);
    expect(isSurveyDue(new Date(2026, 0, 1, 15, 1), now)).toBe(false);
  });
});

describe("reviews", () => {
  it("schedules a review the given number of days later", () => {
    expect(scheduleReview(new Date(2026, 0, 1, 10, 0), 7)).toEqual(new Date(2026, 0, 8, 10, 0));
  });

  it("keeps resurfacing only important notes, at doubling intervals", () => {
    expect(nextReviewDays(7, 3)).toBe(14);
    expect(nextReviewDays(0, 3)).toBe(2);
    expect(nextReviewDays(7, 2)).toBeNull();
    expect(nextReviewDays(7, 1)).toBeNull();
  });
});
