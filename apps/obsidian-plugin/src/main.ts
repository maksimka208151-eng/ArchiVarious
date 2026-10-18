import { buildSurvey, type CaptureSource, learnFromAnswer, suggestPlacements, URI_ACTION } from "@archivarious/core";
import { Notice, Plugin } from "obsidian";
import { CaptureModal } from "./CaptureModal";
import { Inbox, type InboxEntry } from "./inbox";
import { SurveyModal } from "./SurveyModal";
import { type ArchiVariousSettings, ArchiVariousSettingTab, DEFAULT_SETTINGS } from "./settings";
import { buildVaultIndex } from "./vaultIndex";

const SURVEY_CHECK_INTERVAL_MS = 5 * 60_000;

export default class ArchiVariousPlugin extends Plugin {
  override settings: ArchiVariousSettings = DEFAULT_SETTINGS;
  private inbox!: Inbox;
  private surveyOpen = false;

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.inbox = new Inbox(this.app, () => this.settings);

    this.addRibbonIcon("brain", "ArchiVarious: quick capture", () => this.openCapture());
    this.addCommand({ id: "quick-capture", name: "Quick capture", callback: () => this.openCapture() });
    this.addCommand({ id: "run-due-surveys", name: "Sort due captures now", callback: () => this.runDueSurveys(true) });
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
    new CaptureModal(this.app, (raw) => this.capture(raw, "plugin")).open();
  }

  private async capture(raw: string, source: CaptureSource): Promise<void> {
    await this.inbox.add(raw, source);
    new Notice("ArchiVarious: сохранено во входящие");
  }

  private async runDueSurveys(manual = false): Promise<void> {
    if (this.surveyOpen) return;
    const [next] = await this.inbox.due();
    if (!next) {
      if (manual) new Notice("ArchiVarious: нечего разбирать");
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
        const filed = await this.inbox.file(entry, answers);
        this.settings.feedback = learnFromAnswer(this.settings.feedback, answers.folder, input);
        await this.saveSettings();
        new Notice(`ArchiVarious: → ${filed.path}`);
        void this.runDueSurveys();
      },
      async () => {
        this.surveyOpen = false;
        await this.inbox.snooze(entry);
      },
    ).open();
  }
}
