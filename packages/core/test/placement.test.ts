import { describe, expect, it } from "vitest";
import {
  learnFromAnswer,
  mergeFeedback,
  suggestPlacements,
  suggestRelatedNotes,
  type VaultIndex,
} from "../src/placement";

const index: VaultIndex = {
  folders: [
    { path: "Learning", tags: { books: 4 }, terms: { memory: 3, reading: 2 }, noteCount: 10 },
    { path: "Work", tags: { meeting: 5 }, terms: { project: 6, deadline: 2 }, noteCount: 20 },
    { path: "Cooking", tags: {}, terms: { recipe: 8 }, noteCount: 8 },
  ],
};

describe("suggestPlacements", () => {
  it("ranks folders by tag and term overlap", () => {
    const result = suggestPlacements(
      { title: "Memory palace", body: "Memory palace technique #books", tags: ["books"] },
      index,
    );
    expect(result[0]?.folder).toBe("Learning");
    expect(result[0]?.reasons).toContain("#books");
    expect(result.map((c) => c.folder)).not.toContain("Cooking");
  });

  it("returns nothing when nothing matches", () => {
    expect(suggestPlacements({ title: "xyz", body: "xyz", tags: [] }, index)).toEqual([]);
  });

  it("learns from survey answers", () => {
    const input = { title: "Sourdough starter", body: "Sourdough starter feeding", tags: [] };
    expect(suggestPlacements(input, index)).toEqual([]);
    const feedback = learnFromAnswer({}, "Cooking", input);
    expect(suggestPlacements(input, index, feedback)[0]?.folder).toBe("Cooking");
  });
});

describe("suggestRelatedNotes", () => {
  const notes = [
    { path: "Learning/Memory palace.md", title: "Memory palace", tags: ["memory"], terms: ["memory", "palace"] },
    { path: "Learning/Speed reading.md", title: "Speed reading", tags: [], terms: ["speed", "reading", "books"] },
    { path: "Cooking/Bread.md", title: "Bread", tags: [], terms: ["bread", "flour"] },
  ];

  it("ranks notes by shared tags and terms and drops weak matches", () => {
    const result = suggestRelatedNotes(
      { title: "Memory tricks", body: "Memory tricks for reading books #memory", tags: ["memory"] },
      notes,
    );
    expect(result.map((n) => n.path)).toEqual(["Learning/Memory palace.md", "Learning/Speed reading.md"]);
  });

  it("returns nothing for unrelated text", () => {
    expect(suggestRelatedNotes({ title: "Taxes", body: "Pay taxes", tags: [] }, notes)).toEqual([]);
  });
});

describe("mergeFeedback", () => {
  it("sums weights per folder and term without mutating the inputs", () => {
    const a = { Learning: { memory: 1 }, Work: { plan: 2 } };
    const b = { Learning: { memory: 2, loci: 1 } };
    expect(mergeFeedback(a, b)).toEqual({ Learning: { memory: 3, loci: 1 }, Work: { plan: 2 } });
    expect(a).toEqual({ Learning: { memory: 1 }, Work: { plan: 2 } });
  });
});
