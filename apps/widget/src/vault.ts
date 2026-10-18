import {
  buildCaptureUri,
  type CaptureSource,
  captureFileName,
  DEFAULT_INBOX_FOLDER,
  newCapture,
  serializeCapture,
} from "@archivarious/core";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

export interface WidgetSettings {
  /** Absolute path to the vault root. Empty means "no direct access" → URI transport. */
  vaultPath: string;
  /** Vault name for obsidian:// URIs. */
  vaultName: string;
  inboxFolder: string;
}

const SETTINGS_KEY = "archivarious.settings";

export function loadSettings(): WidgetSettings {
  const defaults: WidgetSettings = { vaultPath: "", vaultName: "", inboxFolder: DEFAULT_INBOX_FOLDER };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: WidgetSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Two transports, same inbox protocol:
 * 1. File: write the capture straight into the vault's inbox folder (desktop, offline, works while Obsidian is closed).
 * 2. URI: hand the text to the plugin via obsidian://archivarious (mobile, where the vault lives in Obsidian's sandbox).
 */
export async function sendCapture(
  raw: string,
  settings: WidgetSettings,
  source: CaptureSource,
): Promise<"file" | "uri"> {
  if (settings.vaultPath) {
    const capture = newCapture(raw, source);
    await invoke("write_capture", {
      vaultPath: settings.vaultPath,
      inboxFolder: settings.inboxFolder,
      fileName: captureFileName(capture),
      contents: serializeCapture(capture),
    });
    return "file";
  }
  await openUrl(buildCaptureUri(raw, source, settings.vaultName || undefined));
  return "uri";
}
