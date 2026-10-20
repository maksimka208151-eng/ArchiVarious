import { type AppendableNote, SECTIONS_FILE, type SurveyAnswers, scheduleReview } from "@archivarious/core";
import { type App, normalizePath, TFile } from "obsidian";
import type { ArchiVariousSettings } from "./settings";

const RELATED_LINE = /\n*Связано: [^\n]*\n?$/;

/**
 * Shared last step for every survey (new capture, old note, review): move the note into the answered
 * folder, record the answers and the next review in frontmatter, and (re)write its "Связано:" links.
 */
export async function placeNote(
  app: App,
  settings: ArchiVariousSettings,
  file: TFile,
  answers: SurveyAnswers,
  options: { basename?: string; related?: string[]; reviewDays?: number | null; frontmatter?: Record<string, unknown> },
): Promise<TFile> {
  const folder = normalizePath(answers.folder);
  if (file.parent?.path !== folder || (options.basename && options.basename !== file.basename)) {
    await ensureFolder(app, folder);
    await app.fileManager.renameFile(file, uniquePath(app, folder, options.basename ?? file.basename));
  }

  const reviewDays = options.reviewDays === undefined ? settings.reviewDays : options.reviewDays;
  await app.fileManager.processFrontMatter(file, (fm) => {
    Object.assign(fm, options.frontmatter);
    fm.kind = answers.kind;
    fm.importance = answers.importance;
    if (reviewDays && reviewDays > 0) {
      fm.review_at = scheduleReview(new Date(), reviewDays).toISOString();
      fm.review_days = reviewDays;
    } else {
      delete fm.review_at;
      delete fm.review_days;
    }
  });

  const targets = [...(options.related ?? [])];
  if (settings.linkFolderHub) targets.unshift((await ensureHub(app, folder)).path);
  const links = [...new Set(targets)]
    .map((path) => app.vault.getAbstractFileByPath(path))
    .filter((f): f is TFile => f instanceof TFile && f.path !== file.path)
    .map((f) => app.fileManager.generateMarkdownLink(f, file.path));
  await app.vault.process(file, (text) => {
    const body = text.replace(RELATED_LINE, "").trimEnd();
    return links.length > 0 ? `${body}\n\nСвязано: ${links.join(" · ")}\n` : `${body}\n`;
  });
  return file;
}

/** Note text for the survey: without frontmatter and our own "Связано:" line, shortened. */
export function surveyBody(text: string, max = 600): string {
  const body = text
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(RELATED_LINE, "")
    .trim();
  return body.length > max ? `${body.slice(0, max)}…` : body;
}

/** Folder hub ("map of content"): `<folder>/<folder name>.md`, created on first use. */
async function ensureHub(app: App, folder: string): Promise<TFile> {
  const name = folder.split("/").pop() || "Notes";
  const hubPath = normalizePath(`${folder}/${name}.md`);
  const existing = app.vault.getAbstractFileByPath(hubPath);
  if (existing instanceof TFile) return existing;
  return app.vault.create(hubPath, `# ${name}\n`);
}

/**
 * Existing notes a new capture can be added to: notes in folders, outside the inbox, except folder hubs
 * and the section list. Folders are offered as the survey's own options, so the list is filtered there.
 */
export function appendableNotes(app: App, inboxFolder: string): AppendableNote[] {
  return app.vault
    .getMarkdownFiles()
    .filter((f) => f.parent && f.parent.path !== "/")
    .filter((f) => !f.path.startsWith(`${inboxFolder}/`) && f.path !== SECTIONS_FILE)
    .filter((f) => f.basename !== f.parent?.name)
    .map((f) => ({ folder: f.parent?.path ?? "", path: f.path, title: f.basename }));
}

export async function ensureFolder(app: App, folder: string): Promise<void> {
  const path = normalizePath(folder);
  if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
}

function uniquePath(app: App, folder: string, title: string): string {
  const base = title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Untitled";
  for (let i = 0; ; i++) {
    const candidate = normalizePath(`${folder}/${i === 0 ? base : `${base} ${i}`}.md`);
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
  }
}
