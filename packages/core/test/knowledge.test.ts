import { describe, expect, it } from "vitest";
import { type GroundedSummary, renderGroundedMarkdown, type SourceDocument, validateEvidence } from "../src/knowledge";

const source: SourceDocument = {
  schemaVersion: 1,
  id: "hash",
  name: "Документ.pdf",
  mediaType: "application/pdf",
  sha256: "hash",
  pageCount: 2,
  fragments: [{ id: "p2-f1", page: 2, text: "Выручка проекта выросла на 15 процентов." }],
  warnings: [],
};
const summary: GroundedSummary = {
  title: "Результаты",
  claims: [
    {
      text: "Выручка увеличилась.",
      evidence: [{ fragmentId: "p2-f1", quote: "Выручка проекта выросла на 15 процентов." }],
    },
  ],
};

describe("grounded evidence", () => {
  it("builds page and extracted-text links from verified evidence", () => {
    const markdown = renderGroundedMarkdown(summary, source);
    expect(markdown).toContain("./original.pdf#page=2");
    expect(markdown).toContain("./extracted.md#p2-f1");
  });
  it.each([
    { fragmentId: "p99-f1", quote: "Выручка проекта выросла на 15 процентов." },
    { fragmentId: "p2-f1", quote: "Выручка проекта выросла на 50 процентов." },
    { fragmentId: "p2-f1", quote: "" },
  ])("rejects nonexistent evidence or fabricated quotes: %o", (evidence) => {
    expect(() =>
      validateEvidence({ title: "Итоги", claims: [{ text: "Рост", evidence: [evidence] }] }, source),
    ).toThrow();
  });
  it("rejects unsupported claims and empty summaries", () => {
    expect(() => validateEvidence({ title: "Итоги", claims: [{ text: "Рост", evidence: [] }] }, source)).toThrow();
    expect(() => validateEvidence({ title: "Итоги", claims: [] }, source)).toThrow();
  });
  it("escapes model-provided markdown links", () => {
    const malicious = { ...summary, title: "<script>" };
    expect(renderGroundedMarkdown(malicious, source)).toContain("\\<script\\>");
  });
});
