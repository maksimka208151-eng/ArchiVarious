import { type ActivityRecord, activityFromFields } from "@archivarious/core";
import { type App, normalizePath } from "obsidian";

/**
 * Statistics inputs from the metadata cache: every note's `created`, `filed` and `suggestion_hit`.
 * Inbox captures count as records and for the streak, but have no section yet.
 */
export function collectActivity(app: App, inboxFolder: string): ActivityRecord[] {
  const inbox = `${normalizePath(inboxFolder)}/`;
  return app.vault
    .getMarkdownFiles()
    .map((file) =>
      activityFromFields(
        file.path.startsWith(inbox) ? file.name : file.path,
        app.metadataCache.getFileCache(file)?.frontmatter ?? {},
      ),
    )
    .filter((r) => r.created || r.filed);
}
