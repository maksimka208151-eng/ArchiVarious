import type { PlacementCandidate } from "./placement";

export type CaptureKind = "fact" | "idea" | "task" | "reference";

export interface SurveyQuestion<T extends string = string> {
  id: string;
  prompt: string;
  options: { value: T; label: string }[];
  /** Folder question only: the user may create a new section or subsection right in the survey. */
  allowCustom?: boolean;
  /** Options that depend on the chosen folder (the notes to append to); `options` is the fallback. */
  optionsByFolder?: Record<string, { value: string; label: string }[]>;
}

/** An existing note a new capture can be added to. `folder` is the note's own folder. */
export interface AppendableNote {
  folder: string;
  path: string;
  title: string;
}

export interface SurveyAnswers {
  folder: string;
  kind: CaptureKind;
  /** 1 (low) – 3 (high). Drives how prominently the note is linked and resurfaced. */
  importance: 1 | 2 | 3;
  /** Sections the user created in this survey; the host adds them to the shared section list. */
  createdSections?: string[];
  /** Vault path of an existing note the capture is added to, instead of a new note. */
  appendTo?: string;
}

/**
 * The survey is intentionally short (three taps): where, what kind, how important.
 * Placement candidates come from the algorithm; the user confirms or corrects them,
 * and that correction is what the algorithm learns from.
 *
 * Folder options are full paths: the algorithm's suggestions first (the best one is preselected), then the
 * user's own sections and subsections (see `sections.ts`), which are offered in every survey. The survey UI
 * shows them as a section row and a subsection row.
 *
 * `appendable` notes add an "append" question: "Новая заметка", or one of the notes in the chosen folder.
 */
export function buildSurvey(
  candidates: PlacementCandidate[],
  fallbackFolder: string,
  sections: string[] = [],
  appendable: AppendableNote[] = [],
): SurveyQuestion[] {
  const suggested = candidates.map((c) => c.folder);
  const folders = [...new Set([...suggested, ...sections])];
  if (folders.length === 0) folders.push(fallbackFolder);
  const appendOptions = (folder: string) => [
    { value: "", label: "Новая заметка" },
    ...appendable.filter((n) => n.folder === folder).map((n) => ({ value: n.path, label: n.title })),
  ];
  return [
    {
      id: "folder",
      prompt: "Раздел",
      options: folders.map((f) => ({ value: f, label: f })),
      allowCustom: true,
    },
    ...(appendable.length > 0
      ? [
          {
            id: "append",
            prompt: "В заметку",
            options: appendOptions(folders[0] ?? ""),
            optionsByFolder: Object.fromEntries(folders.map((f) => [f, appendOptions(f)])),
          },
        ]
      : []),
    {
      id: "kind",
      prompt: "Что это?",
      options: [
        { value: "fact", label: "Факт" },
        { value: "idea", label: "Идея" },
        { value: "task", label: "Задача" },
        { value: "reference", label: "Ссылка / материал" },
      ],
    },
    {
      id: "importance",
      prompt: "Насколько важно?",
      options: [
        { value: "1", label: "Просто сохранить" },
        { value: "2", label: "Пригодится" },
        { value: "3", label: "Важно, напоминать" },
      ],
    },
  ];
}
