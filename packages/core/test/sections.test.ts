import { describe, expect, it } from "vitest";
import {
  addSection,
  buildSurvey,
  parseSections,
  SECTIONS_FILE,
  sectionPath,
  serializeSections,
  snapshotFromSnippets,
} from "../src";

describe("sections", () => {
  it("reads nested bullets as sections and subsections", () => {
    const note = "# Разделы\n\nтекст\n\n- Учеба\n  - Математика\n    - Алгебра\n  * История\n- Работа\n\t- Проекты\n";
    expect(parseSections(note)).toEqual([
      "Учеба",
      "Учеба/Математика",
      "Учеба/Математика/Алгебра",
      "Учеба/История",
      "Работа",
      "Работа/Проекты",
    ]);
    expect(parseSections(null)).toEqual([]);
  });

  it("round-trips through the list note", () => {
    const sections = ["Учеба", "Учеба/Математика", "Работа"];
    expect(parseSections(serializeSections(sections))).toEqual(sections);
  });

  it("adds a subsection right after its section and creates missing parents", () => {
    const sections = ["Учеба", "Учеба/Математика", "Работа"];
    expect(addSection(sections, "Учеба/История")).toEqual(["Учеба", "Учеба/Математика", "Учеба/История", "Работа"]);
    expect(addSection([], "Хобби / Гитара")).toEqual(["Хобби", "Хобби/Гитара"]);
    expect(addSection(sections, "Учеба")).toBe(sections);
  });

  it("keeps section names inside the vault", () => {
    expect(sectionPath("../.obsidian/x")).toBe("obsidian/x");
    expect(sectionPath(" a:b \\ c ")).toBe("a b/c");
  });

  it("offers sections after the algorithm's suggestions", () => {
    const [folder] = buildSurvey([{ folder: "Работа", score: 1, reasons: [] }], "Notes", ["Учеба", "Работа"]);
    expect(folder?.options.map((o) => o.value)).toEqual(["Работа", "Учеба"]);
    const [empty] = buildSurvey([], "Notes", []);
    expect(empty?.options.map((o) => o.value)).toEqual(["Notes"]);
  });

  it("does not index the list note as a note", () => {
    const { index, notes } = snapshotFromSnippets([{ path: SECTIONS_FILE, text: "- Учеба\n" }], "ArchiVarious/Inbox");
    expect(index.folders).toEqual([]);
    expect(notes).toEqual([]);
  });
});
