import { DEFAULT_INBOX_FOLDER, DEFAULT_SURVEY_POLICY, type PlacementFeedback } from "@archivarious/core";
import { type App, PluginSettingTab, Setting } from "obsidian";
import type ArchiVariousPlugin from "./main";

export interface ArchiVariousSettings {
  inboxFolder: string;
  /** Used when the algorithm has no suggestion yet (empty or brand-new vault). */
  fallbackFolder: string;
  surveyDelayMinutes: number;
  snoozeMinutes: number;
  /** Learned per-folder term weights. Lives in data.json so it syncs with the vault. */
  feedback: PlacementFeedback;
}

export const DEFAULT_SETTINGS: ArchiVariousSettings = {
  inboxFolder: DEFAULT_INBOX_FOLDER,
  fallbackFolder: "ArchiVarious/Notes",
  surveyDelayMinutes: DEFAULT_SURVEY_POLICY.delayMinutes,
  snoozeMinutes: DEFAULT_SURVEY_POLICY.snoozeMinutes,
  feedback: {},
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
      .setName("Survey delay (minutes)")
      .setDesc("How long after capturing to ask where the note belongs.")
      .addText((text) =>
        text.setValue(String(this.plugin.settings.surveyDelayMinutes)).onChange(async (value) => {
          const minutes = Number.parseInt(value, 10);
          if (Number.isFinite(minutes) && minutes >= 0) {
            this.plugin.settings.surveyDelayMinutes = minutes;
            await this.plugin.saveSettings();
          }
        }),
      );
  }
}
