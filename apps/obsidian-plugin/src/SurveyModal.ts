import type { CaptureKind, SurveyAnswers, SurveyQuestion } from "@archivarious/core";
import { type App, Modal, Setting } from "obsidian";

/** The short delayed survey: three questions, one tap each, built from core's `buildSurvey`. */
export class SurveyModal extends Modal {
  private readonly answers: Record<string, string> = {};
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
    const { contentEl } = this;
    contentEl.createEl("blockquote", { text: this.body });

    for (const question of this.questions) {
      const wrapper = contentEl.createDiv({ cls: "archivarious-survey__question" });
      wrapper.createEl("p", { text: question.prompt });
      const options = wrapper.createDiv({ cls: "archivarious-survey__options" });
      const preset = this.defaults[question.id];
      const first = question.options.find((o) => o.value === preset) ?? question.options[0];
      if (first) this.answers[question.id] = first.value;

      for (const option of question.options) {
        const button = options.createEl("button", { text: option.label });
        button.toggleClass("is-selected", this.answers[question.id] === option.value);
        button.onclick = () => {
          this.answers[question.id] = option.value;
          for (const b of Array.from(options.children)) b.removeClass("is-selected");
          button.addClass("is-selected");
        };
      }
      if (question.allowCustom) {
        const input = wrapper.createEl("input", { type: "text", placeholder: "или своя папка…" });
        input.oninput = () => {
          if (input.value.trim()) this.answers[question.id] = input.value.trim();
        };
      }
    }

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Позже").onClick(() => this.close()))
      .addButton((b) =>
        b
          .setButtonText("Разложить")
          .setCta()
          .onClick(async () => {
            this.submitted = true;
            this.close();
            await this.onAnswer({
              folder: this.answers.folder ?? "",
              kind: (this.answers.kind ?? "fact") as CaptureKind,
              importance: Number(this.answers.importance ?? 1) as SurveyAnswers["importance"],
            });
          }),
      );
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.submitted) void this.onSkip();
  }
}
