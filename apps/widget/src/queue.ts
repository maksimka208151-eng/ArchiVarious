import {
  type ActivityRecord,
  ATTACHMENTS_FOLDER,
  activityFromNote,
  attachmentFileName,
  type Capture,
  imageEmbed,
  imageExtension,
  isSurveyDue,
  type NoteSnippet,
  nextReviewDays,
  parseCapture,
  readFrontmatter,
  type SurveyAnswers,
  serializeCapture,
  setFrontmatter,
  snoozeSurvey,
  surveyPolicy,
} from "@archivarious/core";
import { invoke } from "@tauri-apps/api/core";
import type { VaultContext, WidgetSettings } from "./vault";
import { fileCapture, normalizeFolder, readSharedSettings } from "./vault";

/**
 * Working through the inbox and the reviews in the widget app, the same way the plugin does in Obsidian:
 * captures waiting for their survey, and filed notes whose `review_at` has come.
 */
export type QueueItem =
  | { kind: "inbox"; path: string; capture: Capture }
  | { kind: "review"; path: string; capture: Capture; reviewDays: number; defaults: Record<string, string> };

export interface Queue {
  inbox: QueueItem[];
  reviews: QueueItem[];
}

/** Everything in the inbox and every note with a review date, earliest first. */
export async function loadQueue(settings: WidgetSettings, context: VaultContext): Promise<Queue> {
  const entries = await invoke<NoteSnippet[]>("list_inbox", {
    vaultPath: settings.vaultPath,
    inboxFolder: context.shared.inboxFolder,
  });
  const inbox: QueueItem[] = [];
  for (const { path, text } of entries) {
    const capture = parseCapture(text);
    if (capture && capture.status !== "filed") inbox.push({ kind: "inbox", path, capture });
  }
  inbox.sort((a, b) => a.capture.surveyAt.localeCompare(b.capture.surveyAt));

  const reviews: QueueItem[] = [];
  for (const { path, text } of context.snippets) {
    const fm = readFrontmatter(text);
    if (!fm.review_at || Number.isNaN(Date.parse(fm.review_at))) continue;
    const title = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
    reviews.push({
      kind: "review",
      path,
      capture: {
        id: path,
        raw: body,
        title,
        body: body.length > 600 ? `${body.slice(0, 600)}…` : body,
        tags: [],
        links: [],
        source: "widget-desktop",
        status: "filed",
        createdAt: fm.created ?? "",
        surveyAt: fm.review_at,
      },
      reviewDays: Number(fm.review_days) || 0,
      defaults: {
        ...(fm.kind ? { kind: fm.kind } : {}),
        ...(fm.importance ? { importance: fm.importance } : {}),
      },
    });
  }
  reviews.sort((a, b) => a.capture.surveyAt.localeCompare(b.capture.surveyAt));
  return { inbox, reviews };
}

export const isDue = (item: QueueItem, now = new Date()) => isSurveyDue(item.capture.surveyAt, now);

/** How many inbox captures are due, reading only the inbox folder (cheap enough for a timer). */
export async function countDueInbox(settings: WidgetSettings): Promise<number> {
  const shared = await readSharedSettings(settings.vaultPath);
  const entries = await invoke<NoteSnippet[]>("list_inbox", {
    vaultPath: settings.vaultPath,
    inboxFolder: shared.inboxFolder,
  });
  const now = new Date();
  return entries
    .map((e) => parseCapture(e.text))
    .filter((c) => c && c.status !== "filed" && isSurveyDue(c.surveyAt, now)).length;
}

/** The folder a note is in now (reviews start from it). */
export function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** Answers the survey for one queue item. Returns where the note ended up. */
export async function answerItem(
  item: QueueItem,
  answers: SurveyAnswers,
  context: VaultContext,
  settings: WidgetSettings,
  suggested?: string,
): Promise<{ path: string; feedback?: WidgetSettings["feedback"] }> {
  const { vaultPath } = settings;
  if (item.kind === "inbox") {
    // The capture becomes a note (or is added to one); the inbox file goes to the vault's trash.
    const result = await fileCapture(item.capture, answers, context, settings, suggested);
    await invoke("trash_note", { vaultPath, path: item.path });
    return result;
  }

  let path = item.path;
  const folder = normalizeFolder(answers.folder, folderOf(path));
  if (folder !== folderOf(path)) path = await invoke<string>("move_note", { vaultPath, path, folder });
  const days = nextReviewDays(item.reviewDays || context.shared.reviewDays, answers.importance);
  const text = await invoke<string>("read_note", { vaultPath, path });
  const now = new Date();
  await invoke("write_note", {
    vaultPath,
    path,
    contents: setFrontmatter(text, {
      kind: answers.kind,
      importance: answers.importance,
      filed: now.toISOString(),
      review_at: days ? new Date(now.getTime() + days * 86_400_000).toISOString() : null,
      review_days: days,
    }),
  });
  return { path };
}

/** "Позже": the item comes back after the usual snooze. */
export async function snoozeItem(item: QueueItem, context: VaultContext, settings: WidgetSettings): Promise<void> {
  const { vaultPath } = settings;
  const at = snoozeSurvey(new Date(), surveyPolicy(context.shared)).toISOString();
  if (item.kind === "inbox") {
    await invoke("write_note", {
      vaultPath,
      path: item.path,
      contents: serializeCapture({ ...item.capture, surveyAt: at }),
    });
  } else {
    const text = await invoke<string>("read_note", { vaultPath, path: item.path });
    await invoke("write_note", { vaultPath, path: item.path, contents: setFrontmatter(text, { review_at: at }) });
  }
}

/** Saves a pasted picture into the vault and returns the embed for the note. */
export async function saveImage(data: ArrayBuffer, mime: string, settings: WidgetSettings): Promise<string> {
  const extension = imageExtension(mime);
  if (!extension) throw new Error("такой формат картинки не поддерживается");
  const path = await invoke<string>("write_attachment", {
    vaultPath: settings.vaultPath,
    folder: ATTACHMENTS_FOLDER,
    fileName: attachmentFileName(extension),
    data: Array.from(new Uint8Array(data)),
  });
  return imageEmbed(path);
}

/** Statistics inputs: filed notes from the vault scan plus the captures still in the inbox. */
export function collectActivity(context: VaultContext, queue: Queue): ActivityRecord[] {
  const records = context.snippets.map(({ path, text }) => activityFromNote(path, text));
  // Inbox captures count as records and for the streak, but have no section yet (no folder in the path).
  for (const item of queue.inbox) records.push({ path: item.capture.id, created: item.capture.createdAt });
  return records.filter((r) => r.created || r.filed);
}
