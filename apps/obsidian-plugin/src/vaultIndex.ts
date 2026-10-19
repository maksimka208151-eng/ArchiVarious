import { type FolderProfile, tokenize, type VaultIndex } from "@archivarious/core";
import { type App, getAllTags } from "obsidian";

/**
 * Builds the algorithm's view of the vault from Obsidian's metadata cache (already in memory,
 * so this needs no file reads). Inbox notes are excluded so captures don't vote for the inbox.
 */
export function buildVaultIndex(app: App, inboxFolder: string): VaultIndex {
  const folders = new Map<string, FolderProfile>();

  for (const file of app.vault.getMarkdownFiles()) {
    const folderPath = file.parent?.path ?? "/";
    if (folderPath === "/" || folderPath.startsWith(inboxFolder)) continue;

    let profile = folders.get(folderPath);
    if (!profile) {
      profile = { path: folderPath, tags: {}, terms: {}, noteCount: 0 };
      folders.set(folderPath, profile);
    }
    profile.noteCount++;

    const cache = app.metadataCache.getFileCache(file);
    for (const tag of cache ? (getAllTags(cache) ?? []) : []) {
      const key = tag.replace(/^#/, "").toLowerCase();
      profile.tags[key] = (profile.tags[key] ?? 0) + 1;
    }
    const headings = cache?.headings?.map((h) => h.heading).join(" ") ?? "";
    for (const term of tokenize(`${file.basename} ${headings}`)) {
      profile.terms[term] = (profile.terms[term] ?? 0) + 1;
    }
  }

  return { folders: [...folders.values()] };
}
