import { QuickCapture } from "@archivarious/ui";
import { type App, Modal } from "obsidian";
import { mount, unmount } from "svelte";

/** Hosts the shared Svelte QuickCapture component inside a native Obsidian modal. */
export class CaptureModal extends Modal {
  private component: ReturnType<typeof mount> | null = null;

  constructor(
    app: App,
    /** `now` = the user chose "sort now": the survey opens right after saving. */
    private readonly onCapture: (raw: string, now: boolean) => Promise<void>,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle("ArchiVarious");
    this.component = mount(QuickCapture, {
      target: this.contentEl,
      props: {
        onsubmit: async (raw: string) => {
          await this.onCapture(raw, false);
          this.close();
        },
        onsubmitNow: async (raw: string) => {
          await this.onCapture(raw, true);
          this.close();
        },
        oncancel: () => this.close(),
      },
    });
  }

  override onClose(): void {
    if (this.component) void unmount(this.component);
    this.component = null;
    this.contentEl.empty();
  }
}
