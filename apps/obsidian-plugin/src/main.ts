import {
  buildSurvey,
  type CaptureSource,
  learnFromAnswer,
  nextReviewDays,
  type PlacementCandidate,
  type SurveyAnswers,
  snoozeSurvey,
  suggestPlacements,
  suggestRelatedNotes,
  URI_ACTION,
} from "@archivarious/core";
import { Notice, Plugin, TFile } from "obsidian";
import { CaptureModal } from "./CaptureModal";
import { placeNote, surveyBody } from "./filing";
import { Inbox, type InboxEntry } from "./inbox";
import { dueReviews, listReviews, noteTags, type ReviewEntry } from "./notes";
import { SurveyModal } from "./SurveyModal";
import { addSections, loadSections, openSectionList } from "./sections";
import { type ArchiVariousSettings, ArchiVariousSettingTab, DEFAULT_SETTINGS } from "./settings";
import { buildNoteProfiles, buildVaultIndex } from "./vaultIndex";

const SURVEY_CHECK_INTERVAL_MS = 5 * 60_000;

/** Anything the survey can be asked about: a new capture, an existing note, or a note due for review. */
interface SurveySubject {
  key: string;
  title: string;
  body: string;
  tags: string[];
  /** Folder the note is in now; offered first so "it's fine where it is" is one tap. */
  currentFolder?: string;
  defaults?: Record<string, string>;
  place(answers: SurveyAnswers, related: string[]): Promise<TFile>;
  skip(): Promise<void>;
}

/** What the next survey is picked from: only due items, or everything in the inbox / up for review. */
type QueueMode = "due" | "inbox" | "reviews";

export default class ArchiVariousPlugin extends Plugin {
  override settings: ArchiVariousSettings = DEFAULT_SETTINGS;
  private inbox!: Inbox;
  private surveyOpen = false;
  private mode: QueueMode = "due";
  /** Items answered or dismissed since the queue was last empty, so a pass never asks twice (also covers metadata cache lag). */
  private skipped = new Set<string>();

  override async onload(): Promise<void> {
    await this.loadSettings();
    this.inbox = new Inbox(this.app, () => this.settings);

    this.addRibbonIcon("brain", "ArchiVarious: quick capture", () => this.openCapture());
    this.addCommand({ id: "quick-capture", name: "Quick capture", callback: () => this.openCapture() });
    this.addCommand({ id: "run-due-surveys", name: "Sort due captures now", callback: () => this.runQueue(true) });
    this.addCommand({
      id: "sort-all-now",
      name: "Sort all inbox captures now",
      callback: () => this.startPass("inbox"),
    });
    this.addCommand({
      id: "review-earlier-notes",
      name: "Review earlier notes now",
      callback: () => this.startPass("reviews"),
    });
    this.addCommand({
      id: "sort-current-note",
      name: "Sort current note",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (file?.extension !== "md") return false;
        if (!checking) void this.sortNote(file);
        return true;
      },
    });
    this.addCommand({
      id: "edit-sections",
      name: "Edit sections",
      callback: () => openSectionList(this.app),
    });
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) =>
          item
            .setTitle("ArchiVarious: разложить")
            .setIcon("brain")
            .onClick(() => this.sortNote(file)),
        );
      }),
    );
    this.addSettingTab(new ArchiVariousSettingTab(this.app, this));

    // obsidian://archivarious?text=… — used by the widget app's mobile fallback and OS shortcuts.
    this.registerObsidianProtocolHandler(URI_ACTION, async (params) => {
      if (!params.text) return this.openCapture();
      await this.capture(params.text, (params.source as CaptureSource | undefined) ?? "uri");
    });

    this.app.workspace.onLayoutReady(() => {
      void this.runQueue();
      this.registerInterval(window.setInterval(() => void this.runQueue(), SURVEY_CHECK_INTERVAL_MS));
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
      void this.openSurvey(this.inboxSubject(entry));
    } else {
      new Notice("ArchiVarious: сохранено во входящие");
    }
  }

  /** Sort any note on demand: an inbox capture, a note from before the plugin, or one filed earlier. */
  private async sortNote(file: TFile): Promise<void> {
    if (this.surveyOpen) return;
    const entry = await this.inbox.entry(file);
    if (entry) return this.openSurvey(this.inboxSubject(entry));
    const review = listReviews(this.app).find((r) => r.file.path === file.path);
    await this.openSurvey(review ? await this.reviewSubject(review) : await this.noteSubject(file));
  }

  private async startPass(mode: QueueMode): Promise<void> {
    this.mode = mode;
    this.skipped.clear();
    await this.runQueue(true);
  }

  private async runQueue(manual = false): Promise<void> {
    if (this.surveyOpen) return;
    const next = await this.nextSubject();
    if (!next) {
      if (manual) new Notice("ArchiVarious: нечего разбирать");
      this.mode = "due";
      this.skipped.clear();
      return;
    }
    await this.openSurvey(next);
  }

  private async nextSubject(): Promise<SurveySubject | null> {
    const fresh = <T extends { key: string }>(items: T[]) => items.filter((s) => !this.skipped.has(s.key));
    if (this.mode !== "reviews") {
      const entries = this.mode === "inbox" ? await this.inbox.list() : await this.inbox.due();
      const [entry] = fresh(entries.filter((e) => e.capture.status !== "filed").map((e) => this.inboxSubject(e)));
      if (entry) return entry;
      if (this.mode === "inbox") return null;
    }
    const reviews = this.mode === "reviews" ? listReviews(this.app) : dueReviews(this.app);
    const [review] = fresh(reviews.map((r) => ({ key: r.file.path, review: r })));
    return review ? this.reviewSubject(review.review) : null;
  }

  private inboxSubject(entry: InboxEntry): SurveySubject {
    const { capture } = entry;
    return {
      key: capture.id,
      title: capture.title,
      body: capture.body,
      tags: capture.tags,
      place: (answers, related) => this.inbox.file(entry, answers, related),
      skip: () => this.inbox.snooze(entry),
    };
  }

  private async noteSubject(file: TFile): Promise<SurveySubject> {
    return {
      key: file.path,
      title: file.basename,
      body: surveyBody(await this.app.vault.cachedRead(file)),
      tags: noteTags(this.app, file),
      currentFolder: file.parent && file.parent.path !== "/" ? file.parent.path : undefined,
      place: (answers, related) => placeNote(this.app, this.settings, file, answers, { related }),
      skip: async () => {},
    };
  }

  private async reviewSubject(review: ReviewEntry): Promise<SurveySubject> {
    const subject = await this.noteSubject(review.file);
    return {
      ...subject,
      title: `Пересмотр: ${review.file.basename}`,
      defaults: {
        ...(review.kind ? { kind: review.kind } : {}),
        ...(review.importance ? { importance: String(review.importance) } : {}),
      },
      place: (answers, related) =>
        placeNote(this.app, this.settings, review.file, answers, {
          related,
          reviewDays: nextReviewDays(review.reviewDays || this.settings.reviewDays, answers.importance),
        }),
      skip: () =>
        this.app.fileManager.processFrontMatter(review.file, (fm) => {
          fm.review_at = snoozeSurvey(new Date(), {
            delayMinutes: this.settings.surveyDelayMinutes,
            snoozeMinutes: this.settings.snoozeMinutes,
          }).toISOString();
        }),
    };
  }

  private async openSurvey(subject: SurveySubject): Promise<void> {
    // Claimed before the first await, so a second survey can't open while this one loads the section list.
    this.surveyOpen = true;
    const input = { title: subject.title, body: subject.body, tags: subject.tags };
    const index = buildVaultIndex(this.app, this.settings.inboxFolder);
    let candidates: PlacementCandidate[] = suggestPlacements(input, index, this.settings.feedback);
    const current = subject.currentFolder;
    if (current) {
      candidates = [{ folder: current, score: Number.POSITIVE_INFINITY, reasons: ["сейчас здесь"] }, ...candidates];
      candidates = candidates.filter((c, i) => i === 0 || c.folder !== current);
    }
    const sections = await loadSections(this.app).catch(() => []);
    const questions = buildSurvey(candidates, this.settings.fallbackFolder, sections);

    new SurveyModal(
      this.app,
      subject.title,
      subject.body,
      questions,
      async (answers) => {
        this.surveyOpen = false;
        await addSections(this.app, answers.createdSections ?? []);
        const related = suggestRelatedNotes(input, buildNoteProfiles(this.app, this.settings.inboxFolder)).map(
          (n) => n.path,
        );
        const placed = await subject.place(answers, related);
        this.settings.feedback = learnFromAnswer(this.settings.feedback, answers.folder, input);
        await this.saveSettings();
        new Notice(`ArchiVarious: → ${placed.path}`);
        this.skipped.add(subject.key).add(placed.path);
        void this.runQueue();
      },
      async () => {
        this.surveyOpen = false;
        this.skipped.add(subject.key);
        await subject.skip();
        if (this.mode !== "due") void this.runQueue();
      },
      { ...subject.defaults, ...(current ? { folder: current } : {}) },
    ).open();
  }
}
