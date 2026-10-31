import { describe, expect, it } from "vitest";
import { buildSurvey } from "../src/survey";

const candidates = [{ folder: "Учеба", score: 1, reasons: [] }];
const notes = [
  { folder: "Учеба", path: "Учеба/Идеи.md", title: "Идеи" },
  { folder: "Работа", path: "Работа/Планы.md", title: "Планы" },
];

describe("buildSurvey: append to a note", () => {
  it("has no append question without notes to add to", () => {
    expect(buildSurvey(candidates, "Inbox").map((q) => q.id)).toEqual(["folder", "kind", "importance"]);
  });

  it("offers a new note, and only the notes of the chosen folder", () => {
    const append = buildSurvey(candidates, "Inbox", ["Работа"], notes).find((q) => q.id === "append");
    expect(append?.optionsByFolder?.Учеба).toEqual([
      { value: "", label: "Новая заметка" },
      { value: "Учеба/Идеи.md", label: "Идеи" },
    ]);
    expect(append?.optionsByFolder?.Работа?.map((o) => o.value)).toEqual(["", "Работа/Планы.md"]);
  });
});
