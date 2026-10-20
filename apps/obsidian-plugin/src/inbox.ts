import {
  appendEntry,
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
import { ensureFolder, placeNote } from "./filing";
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

  async entry(file: TFile): Promise<InboxEntry | null> {
    const capture = parseCapture(await this.app.vault.read(file));
    return capture ? { file, capture } : null;
  }

  async due(now = new Date()): Promise<InboxEntry[]> {
    return (await this.list()).filter((e) => e.capture.status !== "filed" && isSurveyDue(e.capture.surveyAt, now));
  }

  async snooze(entry: InboxEntry): Promise<void> {
    const { snoozeMinutes, surveyDelayMinutes } = this.settings();
    const surveyAt = snoozeSurvey(new Date(), { delayMinutes: surveyDelayMinutes, snoozeMinutes }).toISOString();
    await this.app.vault.process(entry.file, () => serializeCapture({ ...entry.capture, surveyAt }));
  }

  /** Turns the capture into a regular note in its final folder, keeping provenance in frontmatter. */
  async file(entry: InboxEntry, answers: SurveyAnswers, related: string[] = []): Promise<TFile> {
    if (answers.appendTo) return this.appendTo(entry, answers.appendTo);
    const { capture } = entry;
    await this.app.vault.process(entry.file, () => `${capture.body}\n`);
    return placeNote(this.app, this.settings(), entry.file, answers, {
      basename: capture.title,
      related,
      frontmatter: {
        archivarious_id: capture.id,
        created: capture.createdAt,
        ...(capture.tags.length > 0 ? { tags: capture.tags } : {}),
        ...(capture.links.length > 0 ? { links: capture.links } : {}),
      },
    });
  }

  /** Adds the capture's text to the end of an existing note, and removes the capture's own file. */
  private async appendTo(entry: InboxEntry, path: string): Promise<TFile> {
    const target = this.app.vault.getAbstractFileByPath(path);
    if (!(target instanceof TFile)) throw new Error(`Заметка «${path}» не найдена`);
    const when = new Date(entry.capture.createdAt);
    await this.app.vault.process(target, (text) => appendEntry(text, entry.capture.body, when));
    await this.app.fileManager.trashFile(entry.file);
    return target;
  }

  private async ensureFolder(folder: string): Promise<void> {
    await ensureFolder(this.app, folder);
  }
}
