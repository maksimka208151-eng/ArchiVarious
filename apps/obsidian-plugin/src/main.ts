import {
  buildSurvey,
  type CaptureSource,
  learnFromAnswer,
  suggestPlacements,
  suggestRelatedNotes,
  URI_ACTION,
} from "@archivarious/core";
import { Notice, Plugin } from "obsidian";
import { CaptureModal } from "./CaptureModal";
import { Inbox, type InboxEntry } from "./inbox";
import { SurveyModal } from "./SurveyModal";
import { type ArchiVariousSettings, ArchiVariousSettingTab, DEFAULT_SETTINGS } from "./settings";
import { buildNoteProfiles, buildVaultIndex } from "./vaultIndex";

const SURVEY_CHECK_INTERVAL_MS = 5 * 60_000;

export default class ArchiVariousPlugin extends Plugin {
  override settings: ArchiVariousSettings = DEFAULT_SETTINGS;
  private inbox!: Inbox;
  private surveyOpen = false;
  /** "Sort all now" mode: surveys every inbox capture regardless of its survey time, skipping ones dismissed this round. */
  private sortingAll = false;
  private skipped = new Set<string>();

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.inbox = new Inbox(this.app, () => this.settings);

    this.addRibbonIcon("brain", "ArchiVarious: quick capture", () => this.openCapture());
    this.addCommand({ id: "quick-capture", name: "Quick capture", callback: () => this.openCapture() });
    this.addCommand({ id: "run-due-surveys", name: "Sort due captures now", callback: () => this.runDueSurveys(true) });
    this.addCommand({ id: "sort-all-now", name: "Sort all inbox captures now", callback: () => this.sortAllNow() });
    this.addSettingTab(new ArchiVariousSettingTab(this.app, this));

    // obsidian://archivarious?text=… — used by the widget app's mobile fallback and OS shortcuts.
    this.registerObsidianProtocolHandler(URI_ACTION, async (params) => {
      if (!params.text) return this.openCapture();
      await this.capture(params.text, (params.source as CaptureSource | undefined) ?? "uri");
    });

    this.app.workspace.onLayoutReady(() => {
      void this.runDueSurveys();
      this.registerInterval(window.setInterval(() => void this.runDueSurveys(), SURVEY_CHECK_INTERVAL_MS));
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<ArchiVariousSettings> | null) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private openCapture(): void {
    new CaptureModal(this.app, (raw, now) => this.capture(raw, "plugin", now)).open();
  }

  private async capture(raw: string, source: CaptureSource, sortNow = false): Promise<void> {
    const file = await this.inbox.add(raw, source);
    const entry = sortNow ? await this.inbox.entry(file) : null;
    if (entry && !this.surveyOpen) {
      this.openSurvey(entry);
    } else {
      new Notice("ArchiVarious: сохранено во входящие");
    }
  }

  private async sortAllNow(): Promise<void> {
    this.sortingAll = true;
    this.skipped.clear();
    await this.runDueSurveys(true);
  }

  private async runDueSurveys(manual = false): Promise<void> {
    if (this.surveyOpen) return;
    const candidates = this.sortingAll
      ? (await this.inbox.list()).filter((e) => e.capture.status !== "filed" && !this.skipped.has(e.capture.id))
      : await this.inbox.due();
    const [next] = candidates;
    if (!next) {
      if (manual) new Notice("ArchiVarious: нечего разбирать");
      this.sortingAll = false;
      return;
    }
    this.openSurvey(next);
  }

  private openSurvey(entry: InboxEntry): void {
    const { capture } = entry;
    const input = { title: capture.title, body: capture.body, tags: capture.tags };
    const index = buildVaultIndex(this.app, this.settings.inboxFolder);
    const candidates = suggestPlacements(input, index, this.settings.feedback);
    const questions = buildSurvey(candidates, this.settings.fallbackFolder);

    this.surveyOpen = true;
    new SurveyModal(
      this.app,
      capture.title,
      capture.body,
      questions,
      async (answers) => {
        this.surveyOpen = false;
        const related = suggestRelatedNotes(input, buildNoteProfiles(this.app, this.settings.inboxFolder));
        const filed = await this.inbox.file(
          entry,
          answers,
          related.map((n) => n.path),
        );
        this.settings.feedback = learnFromAnswer(this.settings.feedback, answers.folder, input);
        await this.saveSettings();
        new Notice(`ArchiVarious: → ${filed.path}`);
        void this.runDueSurveys();
      },
      async () => {
        this.surveyOpen = false;
        this.skipped.add(capture.id);
        await this.inbox.snooze(entry);
        if (this.sortingAll) void this.runDueSurveys();
      },
    ).open();
  }
}
