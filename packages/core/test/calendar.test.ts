import { describe, expect, it } from "vitest";
import {
  appsScriptSource,
  buildCalendarEvent,
  isAppsScriptUrl,
  parseCalendarResponse,
  parseSharedSettings,
  suggestWhen,
} from "../src";

// Monday 20 October 2026, 10:25 local time.
const now = new Date(2026, 9, 20, 10, 25);

describe("suggestWhen", () => {
  it("reads relative days and clock times", () => {
    expect(suggestWhen("позвонить маме завтра в 15:00", now)).toMatchObject({ date: "2026-10-21", time: "15:00" });
    expect(suggestWhen("послезавтра в 7 вечера тренировка", now)).toMatchObject({ date: "2026-10-22", time: "19:00" });
    expect(suggestWhen("сегодня в 9", now)).toMatchObject({ date: "2026-10-20", time: "09:00" });
  });

  it("reads dates and rolls a past day-month into next year", () => {
    expect(suggestWhen("экзамен 25.10 в 9.30", now)).toMatchObject({ date: "2026-10-25", time: "09:30" });
    expect(suggestWhen("отпуск 05.01", now)).toMatchObject({ date: "2027-01-05", time: "09:00" });
    expect(suggestWhen("встреча 03.11.2026", now)).toMatchObject({ date: "2026-11-03" });
  });

  it("defaults to the next full hour today", () => {
    expect(suggestWhen("купить молоко", now)).toEqual({ date: "2026-10-20", time: "11:00", minutes: 60 });
    expect(suggestWhen("купить молоко", new Date(2026, 9, 20, 23, 10))).toMatchObject({
      date: "2026-10-21",
      time: "00:00",
    });
  });
});

describe("calendar events", () => {
  it("builds timed and all-day events", () => {
    const timed = buildCalendarEvent("Позвонить маме", "Позвонить маме", {
      date: "2026-10-21",
      time: "15:00",
      minutes: 30,
    });
    expect(timed.allDay).toBe(false);
    expect(new Date(timed.end).getTime() - new Date(timed.start).getTime()).toBe(30 * 60_000);
    expect(new Date(timed.start).getHours()).toBe(15);
    expect(buildCalendarEvent("Отпуск", "Отпуск", { date: "2027-01-05", minutes: 60 })).toMatchObject({
      allDay: true,
      start: "2027-01-05",
    });
  });

  it("accepts only Apps Script web app URLs", () => {
    expect(isAppsScriptUrl("https://script.google.com/macros/s/AKfycbx-1_a/exec")).toBe(true);
    expect(isAppsScriptUrl("https://example.com/macros/s/x/exec")).toBe(false);
    expect(isAppsScriptUrl("https://script.google.com/macros/s/x/dev")).toBe(false);
  });

  it("reads the script's reply", () => {
    expect(parseCalendarResponse('{"ok":true,"id":"x"}')).toEqual({ ok: true });
    expect(parseCalendarResponse('{"ok":false,"error":"неверный ключ"}')).toEqual({
      ok: false,
      error: "неверный ключ",
    });
    expect(parseCalendarResponse("<html>").ok).toBe(false);
  });

  it("embeds the key in the script and shares the settings with the widget", () => {
    expect(appsScriptSource('k"1')).toContain('const KEY = "k\\"1";');
    const shared = parseSharedSettings(
      '{"calendarUrl":" https://script.google.com/macros/s/a/exec ","calendarKey":"k"}',
    );
    expect(shared.calendarUrl).toBe("https://script.google.com/macros/s/a/exec");
    expect(shared.calendarKey).toBe("k");
  });
});
