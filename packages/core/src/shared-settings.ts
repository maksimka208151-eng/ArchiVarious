import { DEFAULT_INBOX_FOLDER } from "./inbox";
import type { PlacementFeedback } from "./placement";
import { DEFAULT_REVIEW_DAYS, DEFAULT_SURVEY_POLICY } from "./schedule";

/**
 * The plugin settings the widget app reads (read-only) from `.obsidian/plugins/archivarious/data.json`,
 * so both apps use the same inbox folder, survey delay and learned folder preferences.
 */
export interface SharedSettings {
  inboxFolder: string;
  fallbackFolder: string;
  surveyDelayMinutes: number;
  snoozeMinutes: number;
  linkFolderHub: boolean;
  reviewDays: number;
  feedback: PlacementFeedback;
}

export const DEFAULT_SHARED_SETTINGS: SharedSettings = {
  inboxFolder: DEFAULT_INBOX_FOLDER,
  fallbackFolder: "ArchiVarious/Notes",
  surveyDelayMinutes: DEFAULT_SURVEY_POLICY.delayMinutes,
  snoozeMinutes: DEFAULT_SURVEY_POLICY.snoozeMinutes,
  linkFolderHub: true,
  reviewDays: DEFAULT_REVIEW_DAYS,
  feedback: {},
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

  const text = (key: "inboxFolder" | "fallbackFolder") => {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) result[key] = value.trim();
  };
  const count = (key: "surveyDelayMinutes" | "snoozeMinutes" | "reviewDays") => {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) result[key] = value;
  };
  text("inboxFolder");
  text("fallbackFolder");
  count("surveyDelayMinutes");
  count("snoozeMinutes");
  count("reviewDays");
  if (typeof raw.linkFolderHub === "boolean") result.linkFolderHub = raw.linkFolderHub;
  if (typeof raw.feedback === "object" && raw.feedback !== null) result.feedback = raw.feedback as PlacementFeedback;
  return result;
}
