import { isSurveyDue } from "@archivarious/core";
import { type App, getAllTags, type TFile } from "obsidian";

/** A filed note whose frontmatter asks for a review survey ("does it still belong here?"). */
export interface ReviewEntry {
  file: TFile;
  reviewAt: string;
  reviewDays: number;
  kind?: string;
  importance?: number;
}

/** Notes with `review_at`, read from the metadata cache (no file reads). Earliest first. */
export function listReviews(app: App): ReviewEntry[] {
  const entries: ReviewEntry[] = [];
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (typeof fm?.review_at !== "string") continue;
    entries.push({
      file,
      reviewAt: fm.review_at,
      reviewDays: Number(fm.review_days) || 0,
      kind: typeof fm.kind === "string" ? fm.kind : undefined,
      importance: Number(fm.importance) || undefined,
    });
  }
  return entries.sort((a, b) => a.reviewAt.localeCompare(b.reviewAt));
}

export function dueReviews(app: App, now = new Date()): ReviewEntry[] {
  return listReviews(app).filter((r) => isSurveyDue(r.reviewAt, now));
}

export function noteTags(app: App, file: TFile): string[] {
  const cache = app.metadataCache.getFileCache(file);
  return cache ? (getAllTags(cache) ?? []).map((t) => t.replace(/^#/, "").toLowerCase()) : [];
}
