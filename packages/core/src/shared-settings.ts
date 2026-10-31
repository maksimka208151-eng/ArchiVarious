import { DEFAULT_INBOX_FOLDER } from "./inbox";
import type { PlacementFeedback } from "./placement";
import { DEFAULT_REVIEW_DAYS, DEFAULT_SURVEY_POLICY, parseClock, type SurveyPolicy } from "./schedule";

/**
 * The plugin settings the widget app reads (read-only) from `.obsidian/plugins/archivarious/data.json`,
 * so both apps use the same inbox folder, survey delay and learned folder preferences.
 */
export interface SharedSettings {
  inboxFolder: string;
  fallbackFolder: string;
  surveyDelayMinutes: number;
  /** `"21:00"`: ask every evening at that time instead of after `surveyDelayMinutes`. Empty = use the delay. */
  surveyTime: string;
  /** Quiet hours, local time: no surveys from `quietFrom` to `quietTo`. Equal values turn them off. */
  quietFrom: number;
  quietTo: number;
  snoozeMinutes: number;
  linkFolderHub: boolean;
  reviewDays: number;
  feedback: PlacementFeedback;
  /** Google Calendar: the user's Apps Script web app URL and its key (see `calendar.ts`). Empty = not set up. */
  calendarUrl: string;
  calendarKey: string;
}

export const DEFAULT_SHARED_SETTINGS: SharedSettings = {
  inboxFolder: DEFAULT_INBOX_FOLDER,
  fallbackFolder: "ArchiVarious/Notes",
  surveyDelayMinutes: DEFAULT_SURVEY_POLICY.delayMinutes,
  surveyTime: "",
  quietFrom: DEFAULT_SURVEY_POLICY.quietHours?.from ?? 23,
  quietTo: DEFAULT_SURVEY_POLICY.quietHours?.to ?? 8,
  snoozeMinutes: DEFAULT_SURVEY_POLICY.snoozeMinutes,
  linkFolderHub: true,
  reviewDays: DEFAULT_REVIEW_DAYS,
  feedback: {},
  calendarUrl: "",
  calendarKey: "",
};

/** Tolerant parse: missing file, broken JSON or wrong types fall back field by field to the defaults. */
export function parseSharedSettings(json: string | null | undefined): SharedSettings {
  const result = { ...DEFAULT_SHARED_SETTINGS };
  let data: unknown;
  try {
    data = json ? JSON.parse(json) : null;
  } catch {
    return result;
  }
  if (typeof data !== "object" || data === null) return result;
  const raw = data as Record<string, unknown>;

  const text = (key: "inboxFolder" | "fallbackFolder" | "calendarUrl" | "calendarKey") => {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) result[key] = value.trim();
  };
  const count = (key: "surveyDelayMinutes" | "snoozeMinutes" | "reviewDays") => {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) result[key] = value;
  };
  text("inboxFolder");
  text("fallbackFolder");
  text("calendarUrl");
  text("calendarKey");
  count("surveyDelayMinutes");
  count("snoozeMinutes");
  count("reviewDays");
  if (typeof raw.surveyTime === "string" && parseClock(raw.surveyTime)) result.surveyTime = raw.surveyTime.trim();
  for (const key of ["quietFrom", "quietTo"] as const) {
    const value = raw[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 24) result[key] = value;
  }
  if (typeof raw.linkFolderHub === "boolean") result.linkFolderHub = raw.linkFolderHub;
  if (typeof raw.feedback === "object" && raw.feedback !== null) result.feedback = raw.feedback as PlacementFeedback;
  return result;
}

/** The survey timing these settings describe, for `newCapture` / `snoozeSurvey`. */
export function surveyPolicy(
  settings: Pick<SharedSettings, "surveyDelayMinutes" | "snoozeMinutes" | "surveyTime" | "quietFrom" | "quietTo">,
): SurveyPolicy {
  return {
    delayMinutes: settings.surveyDelayMinutes,
    snoozeMinutes: settings.snoozeMinutes,
    quietHours: { from: settings.quietFrom, to: settings.quietTo },
    ...(parseClock(settings.surveyTime) ? { at: settings.surveyTime } : {}),
  };
}
