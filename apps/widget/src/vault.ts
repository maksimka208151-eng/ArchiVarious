import {
  type AppendableNote,
  addSection,
  buildCalendarEvent,
  buildCaptureUri,
  buildSurvey,
  type Capture,
  type CaptureSource,
  calendarRequestBody,
  captureFileName,
  type EventWhen,
  entryBlock,
  hubNote,
  isAppsScriptUrl,
  learnFromAnswer,
  lightFormat,
  mergeFeedback,
  type NoteRef,
  type NoteSnippet,
  newCapture,
  noteFileName,
  type PlacementFeedback,
  parseCalendarResponse,
  parseSections,
  parseSharedSettings,
  SECTIONS_FILE,
  type SharedSettings,
  type SurveyAnswers,
  serializeCapture,
  serializeFiledNote,
  serializeSections,
  snapshotFromSnippets,
  suggestPlacements,
  suggestRelatedNotes,
  type VaultSnapshot,
} from "@archivarious/core";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export type Placement = "desktop" | "top";

export interface WidgetSettings {
  /** Absolute path to the vault root. Empty means "no direct access" → URI transport (mobile). */
  vaultPath: string;
  /** Vault name for obsidian:// URIs. */
  vaultName: string;
  /** "desktop": sits on the desktop under other windows; "top": stays above all windows. */
  placement: Placement;
  /** Folder preferences learned from this app's own sorting, added to the plugin's. */
  feedback: PlacementFeedback;
  /** Google Calendar Apps Script URL and key. Empty = use the plugin's (if it is set up there). */
  calendarUrl: string;
  calendarKey: string;
}

const SETTINGS_KEY = "archivarious.settings";

export function loadSettings(): WidgetSettings {
  const defaults: WidgetSettings = {
    vaultPath: "",
    vaultName: "",
    placement: "desktop",
    feedback: {},
    calendarUrl: "",
    calendarKey: "",
  };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: WidgetSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** The plugin's settings (inbox folder, survey and review delays, learned preferences) if it is installed in the vault. */
export async function readSharedSettings(vaultPath: string): Promise<SharedSettings> {
  return parseSharedSettings(await invoke<string | null>("read_plugin_data", { vaultPath }));
}

/**
 * Two transports, same inbox protocol:
 * 1. File: write the capture straight into the vault's inbox folder (desktop, offline, works while Obsidian is closed).
 * 2. URI: hand the text to the plugin via obsidian://archivarious (mobile, where the vault lives in Obsidian's sandbox).
 */
export async function sendCapture(
  raw: string,
  settings: WidgetSettings,
  source: CaptureSource,
): Promise<{ via: "file" | "uri"; capture?: Capture }> {
  if (settings.vaultPath) {
    const shared = await readSharedSettings(settings.vaultPath);
    const capture = newCapture(raw, source, new Date(), {
      delayMinutes: shared.surveyDelayMinutes,
      snoozeMinutes: shared.snoozeMinutes,
    });
    await invoke("write_capture", {
      vaultPath: settings.vaultPath,
      inboxFolder: shared.inboxFolder,
      fileName: captureFileName(capture),
      contents: serializeCapture(capture),
    });
    return { via: "file", capture };
  }
  await openUrl(buildCaptureUri(raw, source, settings.vaultName || undefined));
  return { via: "uri" };
}

/** What "sort now" needs from the vault; built once per typing session and dropped after filing. */
export interface VaultContext {
  shared: SharedSettings;
  snapshot: VaultSnapshot;
  /** The user's own sections, offered in every survey (shared with the plugin through a note in the vault). */
  sections: string[];
}

export async function loadVaultContext(vaultPath: string): Promise<VaultContext> {
  const shared = await readSharedSettings(vaultPath);
  const [snippets, sections] = await Promise.all([
    invoke<NoteSnippet[]>("scan_vault", { vaultPath, inboxFolder: shared.inboxFolder }),
    invoke<string | null>("read_sections", { vaultPath }),
  ]);
  return { shared, snapshot: snapshotFromSnippets(snippets, shared.inboxFolder), sections: parseSections(sections) };
}

/** Adds sections created in the survey to the shared list (re-read first, the plugin may have changed it) and creates their folders. */
async function addSections(vaultPath: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const current = parseSections(await invoke<string | null>("read_sections", { vaultPath }));
  const next = paths.reduce(addSection, current);
  if (next !== current) {
    await invoke("write_sections", { vaultPath, contents: serializeSections(next), folders: paths });
  }
}

export function prepareSurvey(raw: string, context: VaultContext, settings: WidgetSettings) {
  const capture = newCapture(raw, "widget-desktop", new Date(), {
    delayMinutes: context.shared.surveyDelayMinutes,
    snoozeMinutes: context.shared.snoozeMinutes,
  });
  const input = { title: capture.title, body: capture.body, tags: capture.tags };
  const feedback = mergeFeedback(context.shared.feedback, settings.feedback);
  const candidates = suggestPlacements(input, context.snapshot.index, feedback);
  return {
    capture,
    input,
    questions: buildSurvey(candidates, context.shared.fallbackFolder, context.sections, appendableNotes(context)),
  };
}

/** `Learning\Deep/` → `Learning/Deep`; empty falls back to the plugin's fallback folder. */
/** Existing notes a capture can be added to: outside the inbox, in a folder, and not a folder hub. */
function appendableNotes(context: VaultContext): AppendableNote[] {
  const inbox = `${context.shared.inboxFolder}/`;
  return context.snapshot.notes
    .filter((n) => n.path.includes("/") && !n.path.startsWith(inbox) && n.path !== SECTIONS_FILE)
    .map((n) => ({ folder: n.path.slice(0, n.path.lastIndexOf("/")), path: n.path, title: n.title }))
    .filter((n) => n.title !== n.folder.split("/").pop());
}

export function normalizeFolder(folder: string, fallback: string): string {
  const clean = folder
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return clean || fallback.replace(/^\/+|\/+$/g, "");
}

/** Writes the sorted note (with links to the folder hub and related notes) and returns its vault-relative path. */
export async function fileCapture(
  capture: Capture,
  answers: SurveyAnswers,
  context: VaultContext,
  settings: WidgetSettings,
): Promise<{ path: string; feedback: PlacementFeedback }> {
  const { vaultPath } = settings;
  const folder = normalizeFolder(answers.folder, context.shared.fallbackFolder);
  const input = { title: capture.title, body: capture.body, tags: capture.tags };
  await addSections(vaultPath, answers.createdSections ?? []);

  if (answers.appendTo) {
    const block = entryBlock(capture.body, new Date(capture.createdAt));
    await invoke("append_to_note", { vaultPath, path: answers.appendTo, block });
    return { path: answers.appendTo, feedback: learnFromAnswer(settings.feedback, folder, input) };
  }

  const links: NoteRef[] = [];
  if (context.shared.linkFolderHub) {
    const hub = hubNote(folder);
    await invoke("ensure_note", {
      vaultPath,
      folder,
      fileName: hub.path.slice(folder.length + 1),
      contents: `# ${hub.title}\n`,
    });
    links.push(hub);
  }
  for (const note of suggestRelatedNotes(input, context.snapshot.notes)) {
    if (!links.some((l) => l.path === note.path)) links.push({ path: note.path, title: note.title });
  }

  const name = await invoke<string>("write_note_unique", {
    vaultPath,
    folder,
    fileName: noteFileName(capture.title),
    contents: serializeFiledNote(capture, {
      answers: { folder, kind: answers.kind, importance: answers.importance },
      links,
      reviewDays: context.shared.reviewDays,
    }),
  });
  return { path: `${folder}/${name}`, feedback: learnFromAnswer(settings.feedback, folder, input) };
}

/** The calendar set-up in use: the widget's own, else the plugin's (read from the vault). */
export async function calendarConfig(settings: WidgetSettings): Promise<{ url: string; key: string }> {
  if (settings.calendarUrl && settings.calendarKey) return { url: settings.calendarUrl, key: settings.calendarKey };
  if (!settings.vaultPath) return { url: settings.calendarUrl, key: settings.calendarKey };
  const shared = await readSharedSettings(settings.vaultPath).catch(() => null);
  return {
    url: settings.calendarUrl || shared?.calendarUrl || "",
    key: settings.calendarKey || shared?.calendarKey || "",
  };
}

/** "Task to calendar": creates the event in the user's Google Calendar. Returns the event title; throws a readable error. */
export async function sendToCalendar(raw: string, when: EventWhen, settings: WidgetSettings): Promise<string> {
  const { url, key } = await calendarConfig(settings);
  if (!isAppsScriptUrl(url) || !key) throw new Error("сначала настрой Google Календарь (⚙)");
  const { title, body } = lightFormat(raw);
  const reply = await invoke<string>("send_calendar_event", {
    url,
    body: calendarRequestBody(buildCalendarEvent(title, body, when), key),
  });
  const result = parseCalendarResponse(reply);
  if (!result.ok) throw new Error(result.error);
  return title;
}
