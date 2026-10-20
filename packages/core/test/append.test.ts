import { describe, expect, it } from "vitest";
import { appendEntry, entryBlock } from "../src/append";

const when = new Date(2026, 9, 20, 9, 5);

describe("appendEntry", () => {
  it("writes a dated heading with the text", () => {
    expect(entryBlock("  Купить молоко \n", when)).toBe("### 20.10.2026 09:05\n\nКупить молоко\n");
  });

  it("adds the entry to the end of an existing note, after a blank line", () => {
    expect(appendEntry("# Идеи\n\nПервая.\n\n", "Вторая", when)).toBe(
      "# Идеи\n\nПервая.\n\n### 20.10.2026 09:05\n\nВторая\n",
    );
  });

  it("returns just the entry for an empty note", () => {
    expect(appendEntry("", "Первая", when)).toBe("### 20.10.2026 09:05\n\nПервая\n");
  });
});
