import { type App, Modal, Notice, Setting, type TFile } from "obsidian";
import { DOCUMENTS_FOLDER, type DocumentResult, isDocumentName, openDocumentNote } from "./documents";

export class DocumentImportModal extends Modal {
  private files: (File | TFile)[];

  constructor(
    app: App,
    initialFile: TFile | undefined,
    private readonly acquire: () => (() => void) | undefined,
    private readonly process: (file: File | TFile, allowPartial: boolean) => Promise<DocumentResult>,
  ) {
    super(app);
    this.files = initialFile ? [initialFile] : [];
  }

  override onOpen(): void {
    this.setTitle("Импорт документов");
    const content = this.contentEl;
    const drop = content.createDiv({ cls: "archivarious-document-drop" });
    drop.createEl("p", { text: "Перетащите документы PDF, TXT или Markdown" });
    const picker = drop.createEl("input", { type: "file", attr: { accept: ".pdf,.txt,.md", multiple: "" } });
    picker.setAttribute("aria-label", "Выберите документы для обработки");
    const selected = content.createEl("ul", { cls: "archivarious-document-list" });
    const hint = content.createEl("p", {
      cls: "setting-item-description",
      attr: { role: "status" },
      text: `Оригиналы и заметки сохраняются в «${DOCUMENTS_FOLDER}».`,
    });
    const results = content.createDiv({ cls: "archivarious-document-results", attr: { "aria-live": "polite" } });
    let allowPartial = false;
    let running = false;

    const toggle = new Setting(content)
      .setName("Конспектировать частично прочитанные документы")
      .setDesc("Обрабатывать доступный текст и явно отмечать пропуски.");
    toggle.addToggle((control) =>
      control.setValue(false).onChange((value) => {
        allowPartial = value;
      }),
    );

    const start = content.createEl("button", { cls: "mod-cta", text: "Начать обработку" });
    const renderFiles = () => {
      selected.empty();
      for (const file of this.files) selected.createEl("li", { text: file.name });
      start.disabled = running || this.files.length === 0;
    };
    const select = (files: FileList | null) => {
      if (running || !files?.length) return;
      const supported = Array.from(files).filter((file) => isDocumentName(file.name));
      this.files = supported;
      hint.setText(
        supported.length === files.length
          ? `Выбрано файлов: ${supported.length}.`
          : `Неподдерживаемых файлов: ${files.length - supported.length}. Доступны PDF, TXT и Markdown.`,
      );
      renderFiles();
    };

    picker.addEventListener("change", () => {
      select(picker.files);
      picker.value = "";
    });
    drop.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (!running) drop.addClass("is-dragging");
    });
    drop.addEventListener("dragleave", () => drop.removeClass("is-dragging"));
    drop.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      drop.removeClass("is-dragging");
      select(event.dataTransfer?.files ?? null);
    });
    start.addEventListener("click", async () => {
      if (running || !this.files.length) return;
      const release = this.acquire();
      if (!release) {
        new Notice("ArchiVarious уже обрабатывает документы. Дождитесь завершения.");
        return;
      }
      running = true;
      toggle.setDisabled(true);
      picker.disabled = true;
      renderFiles();
      results.empty();
      const openButtons: HTMLButtonElement[] = [];
      let completed = 0;
      let partial = 0;
      let failed = 0;
      try {
        for (const [index, file] of this.files.entries()) {
          hint.setText(
            `Обработка ${index + 1} из ${this.files.length}. Распознавание и генерация могут занять несколько минут.`,
          );
          const row = results.createDiv({ cls: "archivarious-document-result" });
          row.createEl("strong", { text: file.name });
          const status = row.createEl("p", { text: "В обработке…" });
          try {
            const result = await this.process(file, allowPartial);
            if (result.status === "failed") {
              failed++;
              status.setText(result.message || "Не удалось обработать документ.");
            } else if (result.status === "partial") {
              partial++;
              status.setText(result.message || "Документ обработан частично. Пропуски отмечены в заметке.");
            } else {
              completed++;
              status.setText(result.message || "Конспект сохранён.");
            }
            if (result.directory) row.createEl("small", { text: result.directory });
            if (result.notePath) {
              const path = result.notePath;
              const label = path.endsWith("/summary.md") ? "Открыть конспект" : "Открыть извлечённый текст";
              const button = row.createEl("button", { text: label });
              button.disabled = true;
              openButtons.push(button);
              button.addEventListener("click", async () => {
                try {
                  await openDocumentNote(this.app, path);
                  this.close();
                } catch (error) {
                  new Notice(error instanceof Error ? error.message : "Не удалось открыть заметку.");
                }
              });
            }
          } catch (error) {
            failed++;
            status.setText(error instanceof Error ? error.message : "Не удалось обработать документ.");
          }
        }
      } finally {
        release();
        running = false;
        picker.disabled = false;
        toggle.setDisabled(false);
        for (const button of openButtons) button.disabled = false;
        renderFiles();
      }
      const counts = `Готово: ${completed}, частично: ${partial}, с ошибкой: ${failed}.`;
      hint.setText(counts);
      new Notice(`ArchiVarious. ${counts}`, 8000);
    });
    renderFiles();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
