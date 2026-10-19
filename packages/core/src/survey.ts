import type { PlacementCandidate } from "./placement";

export type CaptureKind = "fact" | "idea" | "task" | "reference";

export interface SurveyQuestion<T extends string = string> {
  id: string;
  prompt: string;
  options: { value: T; label: string }[];
  allowCustom?: boolean;
}

export interface SurveyAnswers {
  folder: string;
  kind: CaptureKind;
  /** 1 (low) – 3 (high). Drives how prominently the note is linked and resurfaced. */
  importance: 1 | 2 | 3;
}

/**
 * The survey is intentionally short (three taps): where, what kind, how important.
 * Placement candidates come from the algorithm; the user confirms or corrects them,
 * and that correction is what the algorithm learns from.
 */
export function buildSurvey(candidates: PlacementCandidate[], fallbackFolder: string): SurveyQuestion[] {
  const folders = candidates.length > 0 ? candidates.map((c) => c.folder) : [fallbackFolder];
  return [
    {
      id: "folder",
      prompt: "Куда это относится?",
      options: folders.map((f) => ({ value: f, label: f })),
      allowCustom: true,
    },
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
