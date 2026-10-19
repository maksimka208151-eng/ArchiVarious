import type { FolderProfile, NoteProfile, VaultIndex } from "./placement";
import { tokenize } from "./placement";

/** The beginning of a note's text plus its vault-relative path (forward slashes). Hosts without a metadata cache read these from disk. */
export interface NoteSnippet {
  path: string;
  text: string;
}

export interface VaultSnapshot {
  index: VaultIndex;
  notes: NoteProfile[];
}

const INLINE_TAG_RE = /(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu;
const HEADING_RE = /^#{1,6}[ \t]+(.+)$/gm;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;

/**
 * Builds the placement index and per-note profiles from raw note snippets. This is the metadata-cache-free
 * twin of the plugin's `buildVaultIndex`/`buildNoteProfiles`: same inputs for the algorithm, so the widget
 * app suggests the same folders without Obsidian running. Notes in the inbox folder and at the vault root
 * don't vote for a folder.
 */
export function snapshotFromSnippets(snippets: NoteSnippet[], inboxFolder: string): VaultSnapshot {
  const inbox = inboxFolder.replace(/^\/+|\/+$/g, "");
  const folders = new Map<string, FolderProfile>();
  const notes: NoteProfile[] = [];

  for (const { path, text } of snippets) {
    if (inbox && path.startsWith(`${inbox}/`)) continue;
    const text0 = text.replace(/\r\n?/g, "\n");
    const slash = path.lastIndexOf("/");
    const folder = slash < 0 ? "" : path.slice(0, slash);
    const basename = path.slice(slash + 1).replace(/\.md$/i, "");

    const { tags, body } = readTags(text0);
    const headings = [...body.matchAll(HEADING_RE)].map((m) => m[1] ?? "").join(" ");
    const terms = tokenize(`${basename} ${headings}`);
    notes.push({ path, title: basename, tags, terms });

    if (!folder) continue;
    let profile = folders.get(folder);
    if (!profile) {
      profile = { path: folder, tags: {}, terms: {}, noteCount: 0 };
      folders.set(folder, profile);
    }
    profile.noteCount++;
    for (const tag of tags) profile.tags[tag] = (profile.tags[tag] ?? 0) + 1;
    for (const term of terms) profile.terms[term] = (profile.terms[term] ?? 0) + 1;
  }
  return { index: { folders: [...folders.values()] }, notes };
}

/** Tags from `tags:` frontmatter (flow list, comma list or block list) and inline `#tags`, lowercased and unique. */
function readTags(text: string): { tags: string[]; body: string } {
  const fm = FRONTMATTER_RE.exec(text);
  const body = fm ? text.slice(fm[0].length) : text;
  const found: string[] = [];

  if (fm?.[1]) {
    const lines = fm[1].split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = /^tags:\s*(.*)$/.exec(lines[i] ?? "");
      if (!m) continue;
      const inline = (m[1] ?? "").trim();
      if (inline) {
        found.push(...inline.replace(/^\[|\]$/g, "").split(","));
      } else {
        for (let j = i + 1; j < lines.length; j++) {
          const item = /^\s*-\s+(.+)$/.exec(lines[j] ?? "");
          if (!item) break;
          found.push(item[1] ?? "");
        }
      }
    }
  }
  for (const m of body.matchAll(INLINE_TAG_RE)) found.push(m[1] ?? "");

  const tags = found
    .map((t) =>
      t
        .trim()
        .replace(/^["']|["']$/g, "")
        .replace(/^#/, "")
        .toLowerCase(),
    )
    .filter(Boolean);
  return { tags: [...new Set(tags)], body };
}
