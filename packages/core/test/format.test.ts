import { describe, expect, it } from "vitest";
import { deriveTitle, lightFormat } from "../src/format";

describe("lightFormat", () => {
  it("normalises whitespace and capitalises the first letter", () => {
    const result = lightFormat("  купить   молоко\r\n\n\n\nи хлеб  ");
    expect(result.body).toBe("Купить молоко\n\nи хлеб");
  });

  it("extracts tags and links", () => {
    const result = lightFormat("read https://example.com/a #Books #books #идеи");
    expect(result.tags).toEqual(["books", "идеи"]);
    expect(result.links).toEqual(["https://example.com/a"]);
  });

  it("derives a short title without tags, links or trailing punctuation", () => {
    expect(deriveTitle("Spaced repetition works! #learning")).toBe("Spaced repetition works");
    expect(deriveTitle("one two three four five six seven eight nine")).toBe(
      "one two three four five six seven eight…",
    );
    expect(deriveTitle("https://example.com")).toBe("Untitled");
  });
});
