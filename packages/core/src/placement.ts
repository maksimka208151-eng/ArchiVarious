/** A lightweight snapshot of the vault the algorithm can score against. Built by the host (plugin) from the Obsidian metadata cache. */
export interface VaultIndex {
  folders: FolderProfile[];
}

export interface FolderProfile {
  path: string;
  /** Tags used by notes in this folder, with counts. */
  tags: Record<string, number>;
  /** Frequent title/body terms of notes in this folder, with counts. */
  terms: Record<string, number>;
  noteCount: number;
}

export interface PlacementInput {
  title: string;
  body: string;
  tags: string[];
}

export interface PlacementCandidate {
  folder: string;
  score: number;
  reasons: string[];
}

/** Learned preferences: survey answers feed back in as per-folder boosts for terms/tags. */
export type PlacementFeedback = Record<string, Record<string, number>>;

const TAG_WEIGHT = 3;
const TERM_WEIGHT = 1;
const FEEDBACK_WEIGHT = 2;

/**
 * Baseline placement algorithm: weighted overlap between the capture's tags/terms and each folder's
 * profile, normalised by folder size, plus feedback learned from earlier surveys.
 * Deliberately simple and deterministic so it is testable; it is the seam where smarter
 * algorithms (embeddings, local models) plug in later without touching the hosts.
 */
export function suggestPlacements(
  input: PlacementInput,
  index: VaultIndex,
  feedback: PlacementFeedback = {},
  limit = 3,
): PlacementCandidate[] {
  const terms = tokenize(`${input.title} ${input.body}`);
  const candidates = index.folders.map((folder) => {
    const reasons: string[] = [];
    let score = 0;

    for (const tag of input.tags) {
      const count = folder.tags[tag] ?? 0;
      if (count > 0) {
        score += TAG_WEIGHT * Math.log1p(count);
        reasons.push(`#${tag}`);
      }
    }
    for (const term of terms) {
      const count = folder.terms[term] ?? 0;
      if (count > 0) score += TERM_WEIGHT * Math.log1p(count);
      const learned = feedback[folder.path]?.[term] ?? 0;
      if (learned > 0) {
        score += FEEDBACK_WEIGHT * learned;
        reasons.push(`learned: ${term}`);
      }
    }

    score /= Math.sqrt(Math.max(folder.noteCount, 1));
    return { folder: folder.path, score, reasons };
  });

  return candidates
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.folder.localeCompare(b.folder))
    .slice(0, limit);
}

/** Record that the user filed a capture into `folder`, so similar captures rank it higher next time. */
export function learnFromAnswer(feedback: PlacementFeedback, folder: string, input: PlacementInput): PlacementFeedback {
  const folderFeedback = { ...(feedback[folder] ?? {}) };
  for (const term of new Set([...tokenize(`${input.title} ${input.body}`), ...input.tags])) {
    folderFeedback[term] = (folderFeedback[term] ?? 0) + 1;
  }
  return { ...feedback, [folder]: folderFeedback };
}

const MIN_TERM_LENGTH = 3;

export function tokenize(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/https?:\/\/\S+/g, " ")
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= MIN_TERM_LENGTH),
    ),
  ];
}

/** A note the capture could link to. Built by the host from its metadata cache. */
export interface NoteProfile {
  path: string;
  title: string;
  tags: string[];
  terms: string[];
}

export interface RelatedNote {
  path: string;
  title: string;
  score: number;
}

/** Minimum overlap to count as related: one shared tag, or two shared terms. */
const MIN_RELATED_SCORE = 2;

/**
 * Finds existing notes that share tags or terms with the capture, so a filed note is linked
 * into the graph instead of floating alone. Same weighting idea as `suggestPlacements`.
 */
export function suggestRelatedNotes(input: PlacementInput, notes: NoteProfile[], limit = 3): RelatedNote[] {
  const terms = new Set(tokenize(`${input.title} ${input.body}`));
  const tags = new Set(input.tags);
  return notes
    .map((note) => {
      const sharedTags = note.tags.filter((t) => tags.has(t)).length;
      const sharedTerms = note.terms.filter((t) => terms.has(t)).length;
      return { path: note.path, title: note.title, score: TAG_WEIGHT * sharedTags + TERM_WEIGHT * sharedTerms };
    })
    .filter((n) => n.score >= MIN_RELATED_SCORE)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/** Adds two sets of learned preferences (e.g. the plugin's and the widget app's) without mutating either. */
export function mergeFeedback(a: PlacementFeedback, b: PlacementFeedback): PlacementFeedback {
  const merged: PlacementFeedback = {};
  for (const source of [a, b]) {
    for (const [folder, terms] of Object.entries(source)) {
      const target = merged[folder] ?? {};
      merged[folder] = target;
      for (const [term, weight] of Object.entries(terms)) target[term] = (target[term] ?? 0) + weight;
    }
  }
  return merged;
}
