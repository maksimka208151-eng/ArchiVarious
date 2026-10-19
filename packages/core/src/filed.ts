import type { Capture } from "./capture";
import { scheduleReview } from "./schedule";
import type { SurveyAnswers } from "./survey";

export interface NoteRef {
  /** Vault-relative path with forward slashes, e.g. `Learning/Memory palace.md`. */
  path: string;
  title: string;
}

export interface FiledNoteOptions {
  answers: SurveyAnswers;
  /** Notes the capture is linked to, in the order they should appear. */
  links: NoteRef[];
  /** Days until the first review survey; 0/undefined = no review. */
  reviewDays?: number;
  now?: Date;
}

/** `[[Folder/Note|Title]]`: a full-path wikilink never resolves to the wrong note when titles repeat. */
export function wikiLink({ path, title }: NoteRef): string {
  return `[[${path.replace(/\.md$/i, "")}|${title.replace(/[|\][]/g, " ")}]]`;
}

/** The folder's hub ("map of content") note: `<folder>/<folder name>.md`. */
export function hubNote(folder: string): NoteRef {
  const clean = folder.replace(/^\/+|\/+$/g, "");
  const name = clean.split("/").pop() || "Notes";
  return { path: `${clean}/${name}.md`, title: name };
}

/** File-system safe note name derived from a title (same rule the plugin uses). */
export function noteFileName(title: string): string {
  const base = title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Untitled";
  return `${base}.md`;
}

/**
 * The final note for a sorted capture: same frontmatter fields the plugin writes with `processFrontMatter`
 * (`archivarious_id`, `created`, `kind`, `importance`, `review_at`, `review_days`, `tags`, `links`), so the
 * plugin's review queue picks up notes filed by the widget app.
 */
export function serializeFiledNote(
  capture: Capture,
  { answers, links, reviewDays, now = new Date() }: FiledNoteOptions,
): string {
  const fm = [
    "---",
    `archivarious_id: ${capture.id}`,
    `created: ${JSON.stringify(capture.createdAt)}`,
    `kind: ${answers.kind}`,
    `importance: ${answers.importance}`,
  ];
  if (capture.tags.length > 0) fm.push(`tags: [${capture.tags.map((t) => JSON.stringify(t)).join(", ")}]`);
  if (capture.links.length > 0) fm.push(`links: [${capture.links.map((l) => JSON.stringify(l)).join(", ")}]`);
  if (reviewDays && reviewDays > 0) {
    fm.push(
      `review_at: ${JSON.stringify(scheduleReview(now, reviewDays).toISOString())}`,
      `review_days: ${reviewDays}`,
    );
  }
  fm.push("---");

  const related = links.length > 0 ? `\n\nСвязано: ${links.map(wikiLink).join(" · ")}` : "";
  return `${fm.join("\n")}\n\n${capture.body}${related}\n`;
}
