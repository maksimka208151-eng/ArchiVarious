import { type ActivityRecord, computeStats } from "@archivarious/core";
import { Stats } from "@archivarious/ui";
import { type App, Modal } from "obsidian";
import { mount, unmount } from "svelte";

/** Records per week, the streak, suggestion accuracy and the fastest-growing sections. */
export class StatsModal extends Modal {
  private component: ReturnType<typeof mount> | null = null;

  constructor(
    app: App,
    private readonly records: ActivityRecord[],
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("ArchiVarious: статистика");
    this.component = mount(Stats, { target: this.contentEl, props: { stats: computeStats(this.records) } });
  }

  override onClose(): void {
    if (this.component) void unmount(this.component);
    this.component = null;
    this.contentEl.empty();
  }
}
