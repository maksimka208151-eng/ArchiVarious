import { ATTACHMENTS_FOLDER, attachmentFileName, imageEmbed, imageExtension } from "@archivarious/core";
import { type App, Notice, normalizePath } from "obsidian";
import { ensureFolder } from "./filing";

/** Saves a picture pasted into the capture window and returns the embed to put into the note. */
export async function saveImage(app: App, data: ArrayBuffer, mime: string): Promise<string> {
  const extension = imageExtension(mime);
  if (!extension) {
    new Notice("ArchiVarious: такой формат картинки не поддерживается");
    throw new Error(`unsupported image type ${mime}`);
  }
  await ensureFolder(app, ATTACHMENTS_FOLDER);
  const name = attachmentFileName(extension);
  let path = normalizePath(`${ATTACHMENTS_FOLDER}/${name}`);
  for (let i = 1; app.vault.getAbstractFileByPath(path); i++) {
    path = normalizePath(`${ATTACHMENTS_FOLDER}/${name.replace(/(\.\w+)$/, ` ${i}$1`)}`);
  }
  await app.vault.createBinary(path, data);
  return imageEmbed(path);
}
