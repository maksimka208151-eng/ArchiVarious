import type { SurveyAnswers, SurveyQuestion } from "@archivarious/core";
import { Survey } from "@archivarious/ui";
import { type App, Modal } from "obsidian";
import { mount, unmount } from "svelte";

/** The short survey (section, kind, importance), hosting the shared Svelte `Survey` the widget app uses too. */
export class SurveyModal extends Modal {
  private component: ReturnType<typeof mount> | null = null;
  private submitted = false;

  constructor(
    app: App,
    private readonly title: string,
    private readonly body: string,
    private readonly questions: SurveyQuestion[],
    private readonly onAnswer: (answers: SurveyAnswers) => Promise<void>,
    private readonly onSkip: () => Promise<void>,
    /** Preselected answers by question id (e.g. the note's current folder and kind on a review). */
    private readonly defaults: Record<string, string> = {},
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.title);
    this.contentEl.createEl("blockquote", { cls: "archivarious-quote", text: this.body });
    this.component = mount(Survey, {
      target: this.contentEl.createDiv(),
      props: {
        questions: this.questions,
        defaults: this.defaults,
        onanswer: async (answers: SurveyAnswers) => {
          this.submitted = true;
          this.close();
          await this.onAnswer(answers);
        },
        onskip: () => this.close(),
      },
    });
  }

  override onClose(): void {
    if (this.component) void unmount(this.component);
    this.component = null;
    this.contentEl.empty();
    if (!this.submitted) void this.onSkip();
  }
}
