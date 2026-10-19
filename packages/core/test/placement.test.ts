import { describe, expect, it } from "vitest";
import { learnFromAnswer, suggestPlacements, type VaultIndex } from "../src/placement";

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
