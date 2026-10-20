import { describe, expect, it } from "vitest";
import { readFrontmatter, setFrontmatter } from "../src/frontmatter";
import { parseReminders, reminderInstant, splitDue } from "../src/reminders";
import { scheduleSurvey } from "../src/schedule";
import { surveyPolicy } from "../src/shared-settings";
import { activityFromNote, computeStats } from "../src/stats";

const now = new Date(2026, 9, 20, 14, 0);
const daysAgo = (n: number, hour = 10) => new Date(2026, 9, 20 - n, hour).toISOString();

describe("computeStats", () => {
  const records = [
    { path: "Учеба/a.md", created: daysAgo(0), filed: daysAgo(0), hit: true },
    { path: "Учеба/b.md", created: daysAgo(1), hit: false },
    { path: "Работа/c.md", created: daysAgo(2), hit: true },
    { path: "Учеба/d.md", created: daysAgo(9) },
    { path: "Работа/e.md", created: daysAgo(5) },
  ];
  const stats = computeStats(records, now);

  it("counts this and last week, per day", () => {
    expect(stats.thisWeek).toBe(4);
    expect(stats.lastWeek).toBe(1);
    expect(stats.days.map((d) => d.count)).toEqual([0, 1, 0, 0, 1, 1, 1]);
  });

  it("measures how often the first suggestion was kept", () => {
    expect(stats.accuracy).toBeCloseTo(2 / 3);
    expect(stats.surveys).toBe(3);
  });

  it("ranks the sections that grew most this week", () => {
    expect(stats.growing).toEqual([
      { folder: "Работа", added: 2 },
      { folder: "Учеба", added: 2 },
    ]);
  });

  it("counts the streak of active days, today included", () => {
    expect(stats.streak).toBe(3);
    expect(stats.bestStreak).toBe(3);
    expect(stats.activeToday).toBe(true);
  });

  it("keeps yesterday's streak when nothing happened today yet", () => {
    const s = computeStats(
      [
        { path: "a.md", created: daysAgo(1) },
        { path: "b.md", created: daysAgo(2) },
      ],
      now,
    );
    expect(s.streak).toBe(2);
    expect(s.activeToday).toBe(false);
  });

  it("reads the fields from a note's frontmatter", () => {
    const note = `---\ncreated: "${daysAgo(0)}"\nfiled: "${daysAgo(0)}"\nsuggestion_hit: false\n---\n\nText`;
    expect(activityFromNote("X/n.md", note)).toEqual({
      path: "X/n.md",
      created: daysAgo(0),
      filed: daysAgo(0),
      hit: false,
    });
  });
});

describe("frontmatter", () => {
  const note = '---\nkind: idea\ntags: ["a", "b"]\nreview_at: "2026-01-01"\n---\n\nBody\n';

  it("reads flat fields", () => {
    expect(readFrontmatter(note)).toEqual({ kind: "idea", tags: '["a", "b"]', review_at: "2026-01-01" });
  });

  it("sets, adds and removes fields, keeping the rest", () => {
    expect(setFrontmatter(note, { kind: "task", review_at: null, importance: 3 })).toBe(
      '---\nkind: "task"\ntags: ["a", "b"]\nimportance: 3\n---\n\nBody\n',
    );
  });

  it("adds frontmatter to a note without it", () => {
    expect(setFrontmatter("Body\n", { kind: "fact" })).toBe('---\nkind: "fact"\n---\n\nBody\n');
  });
});

describe("survey time", () => {
  const base = { surveyDelayMinutes: 360, snoozeMinutes: 60, surveyTime: "21:00", quietFrom: 23, quietTo: 8 };

  it("asks at the chosen time the same evening, or the next one when it's too close", () => {
    expect(scheduleSurvey(new Date(2026, 9, 20, 10, 0), surveyPolicy(base))).toEqual(new Date(2026, 9, 20, 21, 0));
    expect(scheduleSurvey(new Date(2026, 9, 20, 20, 50), surveyPolicy(base))).toEqual(new Date(2026, 9, 21, 21, 0));
  });

  it("uses the delay and the configured quiet hours without a time", () => {
    const policy = surveyPolicy({ ...base, surveyTime: "", quietFrom: 22, quietTo: 9 });
    expect(scheduleSurvey(new Date(2026, 9, 20, 17, 0), policy)).toEqual(new Date(2026, 9, 21, 9, 0));
    expect(scheduleSurvey(new Date(2026, 9, 20, 10, 0), policy)).toEqual(new Date(2026, 9, 20, 16, 0));
  });

  it("turns quiet hours off when both hours are equal", () => {
    const policy = surveyPolicy({ ...base, surveyTime: "", quietFrom: 0, quietTo: 0 });
    expect(scheduleSurvey(new Date(2026, 9, 20, 20, 0), policy)).toEqual(new Date(2026, 9, 21, 2, 0));
  });
});

describe("reminders", () => {
  it("splits due and upcoming reminders", () => {
    const list = [
      { id: "b", text: "позже", at: new Date(2026, 9, 20, 15, 0).toISOString() },
      { id: "a", text: "сейчас", at: reminderInstant("2026-10-20", "13:59") },
    ];
    const { due, upcoming } = splitDue(list, now);
    expect(due.map((r) => r.id)).toEqual(["a"]);
    expect(upcoming.map((r) => r.id)).toEqual(["b"]);
  });

  it("drops malformed stored reminders", () => {
    expect(parseReminders('[{"id":"a","text":"x","at":"2026-10-20T10:00:00Z"},{"id":1},null]')).toHaveLength(1);
    expect(parseReminders("not json")).toEqual([]);
  });
});
