import {
  type Capture,
  type CaptureSource,
  captureFileName,
  isSurveyDue,
  newCapture,
  parseCapture,
  type SurveyAnswers,
  serializeCapture,
  snoozeSurvey,
} from "@archivarious/core";
import { type App, normalizePath, TFile } from "obsidian";
import type { ArchiVariousSettings } from "./settings";

export interface InboxEntry {
  file: TFile;
  capture: Capture;
}

/** Reads and writes captures in the inbox folder using the shared inbox protocol from core. */
export class Inbox {
  constructor(
    private readonly app: App,
    private readonly settings: () => ArchiVariousSettings,
  ) {}

  async add(raw: string, source: CaptureSource): Promise<TFile> {
    const { inboxFolder, surveyDelayMinutes, snoozeMinutes } = this.settings();
    const capture = newCapture(raw, source, new Date(), { delayMinutes: surveyDelayMinutes, snoozeMinutes });
    await this.ensureFolder(inboxFolder);
    return this.app.vault.create(
      normalizePath(`${inboxFolder}/${captureFileName(capture)}`),
      serializeCapture(capture),
    );
  }

  async list(): Promise<InboxEntry[]> {
    const prefix = `${normalizePath(this.settings().inboxFolder)}/`;
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
    const entries = await Promise.all(
      files.map(async (file) => {
        const capture = parseCapture(await this.app.vault.cachedRead(file));
        return capture ? { file, capture } : null;
      }),
    );
    return entries.filter((e): e is InboxEntry => e !== null);
  }

  async due(now = new Date()): Promise<InboxEntry[]> {
    return (await this.list()).filter((e) => e.capture.status !== "filed" && isSurveyDue(e.capture.surveyAt, now));
  }

  async snooze(entry: InboxEntry): Promise<void> {
    const { snoozeMinutes, surveyDelayMinutes } = this.settings();
    const surveyAt = snoozeSurvey(new Date(), { delayMinutes: surveyDelayMinutes, snoozeMinutes }).toISOString();
    await this.app.vault.process(entry.file, () => serializeCapture({ ...entry.capture, surveyAt }));
  }

  /** Moves the capture to its final folder as a regular note, keeping provenance in frontmatter. */
  async file(entry: InboxEntry, answers: SurveyAnswers): Promise<TFile> {
    const { capture } = entry;
    await this.ensureFolder(answers.folder);
    const target = await this.uniquePath(answers.folder, capture.title);
    await this.app.vault.process(entry.file, () => `${capture.body}\n`);
    await this.app.fileManager.renameFile(entry.file, target);
    const filed = this.app.vault.getAbstractFileByPath(target);
    if (!(filed instanceof TFile)) throw new Error(`ArchiVarious: filed note not found at ${target}`);
    await this.app.fileManager.processFrontMatter(filed, (fm) => {
      fm.archivarious_id = capture.id;
      fm.created = capture.createdAt;
      fm.kind = answers.kind;
      fm.importance = answers.importance;
      if (capture.tags.length > 0) fm.tags = capture.tags;
      if (capture.links.length > 0) fm.links = capture.links;
    });
    return filed;
  }

  private async ensureFolder(folder: string): Promise<void> {
    const path = normalizePath(folder);
    if (!this.app.vault.getAbstractFileByPath(path)) await this.app.vault.createFolder(path);
  }

  private async uniquePath(folder: string, title: string): Promise<string> {
    const base = title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Untitled";
    for (let i = 0; ; i++) {
      const candidate = normalizePath(`${folder}/${i === 0 ? base : `${base} ${i}`}.md`);
      if (!this.app.vault.getAbstractFileByPath(candidate)) return candidate;
    }
  }
}
