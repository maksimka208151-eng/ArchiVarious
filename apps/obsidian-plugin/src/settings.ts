import {
  appsScriptSource,
  DEFAULT_INBOX_FOLDER,
  DEFAULT_REVIEW_DAYS,
  DEFAULT_SHARED_SETTINGS,
  DEFAULT_SURVEY_POLICY,
  isAppsScriptUrl,
  type PlacementFeedback,
  parseClock,
} from "@archivarious/core";
import { type App, type DropdownComponent, Notice, PluginSettingTab, Setting } from "obsidian";
import type ArchiVariousPlugin from "./main";

export interface ArchiVariousSettings {
  inboxFolder: string;
  /** Used when the algorithm has no suggestion yet (empty or brand-new vault). */
  fallbackFolder: string;
  surveyDelayMinutes: number;
  /** `"21:00"`: ask every day at that time instead of after the delay. Empty = after the delay. */
  surveyTime: string;
  /** No surveys from `quietFrom` to `quietTo` (local hours). Equal = no quiet hours. */
  quietFrom: number;
  quietTo: number;
  snoozeMinutes: number;
  /** Link each filed note to its folder's hub note, so every topic forms a cluster in the graph. */
  linkFolderHub: boolean;
  /** Days after filing before a note comes back for a review survey. 0 turns reviews off. */
  reviewDays: number;
  /** Learned per-folder term weights. Lives in data.json so it syncs with the vault. */
  feedback: PlacementFeedback;
  /** Google Calendar Apps Script web app (see core `calendar.ts`); the widget app reads these too. */
  calendarUrl: string;
  calendarKey: string;
}

export const DEFAULT_SETTINGS: ArchiVariousSettings = {
  inboxFolder: DEFAULT_INBOX_FOLDER,
  fallbackFolder: "ArchiVarious/Notes",
  surveyDelayMinutes: DEFAULT_SURVEY_POLICY.delayMinutes,
  surveyTime: DEFAULT_SHARED_SETTINGS.surveyTime,
  quietFrom: DEFAULT_SHARED_SETTINGS.quietFrom,
  quietTo: DEFAULT_SHARED_SETTINGS.quietTo,
  snoozeMinutes: DEFAULT_SURVEY_POLICY.snoozeMinutes,
  linkFolderHub: true,
  reviewDays: DEFAULT_REVIEW_DAYS,
  feedback: {},
  calendarUrl: "",
  calendarKey: "",
};

export class ArchiVariousSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: ArchiVariousPlugin,
  ) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Inbox folder")
      .setDesc("Where new captures land until their survey. The widget app writes here too.")
      .addText((text) =>
        text.setValue(this.plugin.settings.inboxFolder).onChange(async (value) => {
          this.plugin.settings.inboxFolder = value.trim() || DEFAULT_SETTINGS.inboxFolder;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Fallback folder")
      .setDesc("Offered in the survey when there is no better suggestion yet.")
      .addText((text) =>
        text.setValue(this.plugin.settings.fallbackFolder).onChange(async (value) => {
          this.plugin.settings.fallbackFolder = value.trim() || DEFAULT_SETTINGS.fallbackFolder;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Link to folder hub")
      .setDesc("Link each filed note to a hub note named after its folder (created if missing).")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.linkFolderHub).onChange(async (value) => {
          this.plugin.settings.linkFolderHub = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl)
      .setName("Review after (days)")
      .setDesc(
        "Filed notes come back for a short review after this many days; important ones keep coming back. 0 turns reviews off.",
      )
      .addText((text) =>
        text.setValue(String(this.plugin.settings.reviewDays)).onChange(async (value) => {
          const days = Number.parseInt(value, 10);
          if (Number.isFinite(days) && days >= 0) {
            this.plugin.settings.reviewDays = days;
            await this.plugin.saveSettings();
          }
        }),
      );

    new Setting(containerEl).setName("Google Календарь").setHeading();
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Режим «Задача в календарь» создаёт событие в твоём Google Календаре через маленький скрипт в твоём же аккаунте Google. Шаг 1: скопируй скрипт и следуй инструкции в его первых строках. Шаг 2: вставь адрес веб-приложения ниже.",
    });
    new Setting(containerEl)
      .setName("Скрипт для Google")
      .setDesc("Копирует код скрипта с твоим секретным ключом. Ключ создаётся один раз и хранится в настройках.")
      .addButton((button) =>
        button.setButtonText("Скопировать скрипт").onClick(async () => {
          if (!this.plugin.settings.calendarKey) {
            this.plugin.settings.calendarKey = crypto.randomUUID();
            await this.plugin.saveSettings();
          }
          await navigator.clipboard.writeText(appsScriptSource(this.plugin.settings.calendarKey));
          new Notice("Скрипт скопирован. Вставь его на script.google.com");
        }),
      );
    new Setting(containerEl)
      .setName("Адрес веб-приложения")
      .setDesc("Вида https://script.google.com/macros/s/…/exec")
      .addText((text) =>
        text
          .setPlaceholder("https://script.google.com/macros/s/…/exec")
          .setValue(this.plugin.settings.calendarUrl)
          .onChange(async (value) => {
            const url = value.trim();
            text.inputEl.toggleClass("archivarious-invalid", url !== "" && !isAppsScriptUrl(url));
            if (url === "" || isAppsScriptUrl(url)) {
              this.plugin.settings.calendarUrl = url;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl).setName("Когда спрашивать").setHeading();
    const { settings } = this.plugin;
    new Setting(containerEl)
      .setName("Опрос")
      .setDesc("Через несколько часов после записи или каждый день в одно и то же время, например вечером.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("delay", "Через заданное время")
          .addOption("time", "В определённое время")
          .setValue(settings.surveyTime ? "time" : "delay")
          .onChange(async (value) => {
            settings.surveyTime = value === "time" ? "21:00" : "";
            await this.plugin.saveSettings();
            this.display();
          }),
      );
    if (settings.surveyTime) {
      new Setting(containerEl)
        .setName("Время опроса")
        .setDesc(
          "Записи за день придут на разбор в это время. Сделанные позже чем за 30 минут до него — на следующий день.",
        )
        .addText((text) => {
          text.inputEl.type = "time";
          text.setValue(settings.surveyTime).onChange(async (value) => {
            if (!parseClock(value)) return;
            settings.surveyTime = value;
            await this.plugin.saveSettings();
          });
        });
    } else {
      new Setting(containerEl)
        .setName("Через сколько спрашивать (часы)")
        .setDesc("Сколько ждать после записи, прежде чем спросить, куда её положить.")
        .addText((text) =>
          text.setValue(String(settings.surveyDelayMinutes / 60)).onChange(async (value) => {
            const hours = Number.parseFloat(value.replace(",", "."));
            if (Number.isFinite(hours) && hours >= 0) {
              settings.surveyDelayMinutes = Math.round(hours * 60);
              await this.plugin.saveSettings();
            }
          }),
        );
    }
    const hours = (dropdown: DropdownComponent) => {
      for (let h = 0; h < 24; h++) dropdown.addOption(String(h), `${String(h).padStart(2, "0")}:00`);
      return dropdown;
    };
    new Setting(containerEl)
      .setName("Тихие часы")
      .setDesc("В это время опросы не приходят и переносятся на утро. Одинаковое время — без тихих часов.")
      .addDropdown((dropdown) =>
        hours(dropdown)
          .setValue(String(settings.quietFrom))
          .onChange(async (value) => {
            settings.quietFrom = Number(value);
            await this.plugin.saveSettings();
          }),
      )
      .addDropdown((dropdown) =>
        hours(dropdown)
          .setValue(String(settings.quietTo))
          .onChange(async (value) => {
            settings.quietTo = Number(value);
            await this.plugin.saveSettings();
          }),
      );
  }
}
