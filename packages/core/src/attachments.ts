/** Pictures pasted into a capture (screenshots, images from the clipboard) are saved into this vault folder. */
export const ATTACHMENTS_FOLDER = "ArchiVarious/Вложения";

const EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** File extension for a pasted image type, or null for anything that isn't a supported picture. */
export function imageExtension(mime: string): string | null {
  return EXTENSIONS[mime.toLowerCase()] ?? null;
}

/** `Картинка 2026-10-20 14-05-09.png`: sortable, readable, and safe on every file system. */
export function attachmentFileName(extension: string, now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `Картинка ${stamp}.${extension}`;
}

/** The embed that shows the picture inside the note. */
export function imageEmbed(path: string): string {
  return `![[${path}]]`;
}
