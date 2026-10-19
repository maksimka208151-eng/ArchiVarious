import { describe, expect, it } from "vitest";
import { hubNote, noteFileName, serializeFiledNote, wikiLink } from "../src/filed";
import { newCapture } from "../src/inbox";
import { parseSharedSettings } from "../src/shared-settings";

describe("filed notes", () => {
  const now = new Date("2026-03-04T05:06:07.000Z");
  const capture = newCapture("memory palace trick #idea\nhttps://example.com", "widget-desktop", now);

  it("builds wikilinks and hub notes", () => {
    expect(wikiLink({ path: "Learning/Memory palace.md", title: "Memory | palace" })).toBe(
      "[[Learning/Memory palace|Memory   palace]]",
    );
    expect(hubNote("Learning/Deep/")).toEqual({ path: "Learning/Deep/Deep.md", title: "Deep" });
  });

  it("makes file-safe names", () => {
    expect(noteFileName('a/b: "c"?')).toBe("ab c.md");
    expect(noteFileName("###")).toBe("Untitled.md");
  });

  it("writes the frontmatter the plugin's review queue reads, then the links", () => {
    const text = serializeFiledNote(capture, {
      answers: { folder: "Learning", kind: "idea", importance: 3 },
      links: [hubNote("Learning"), { path: "Learning/Memory palace.md", title: "Memory palace" }],
      reviewDays: 7,
      now,
    });
    expect(text).toContain(`archivarious_id: ${capture.id}`);
    expect(text).toContain("kind: idea\nimportance: 3");
    expect(text).toContain('tags: ["idea"]');
    expect(text).toContain('review_at: "2026-03-11T05:06:07.000Z"\nreview_days: 7');
    expect(text).toContain("Связано: [[Learning/Learning|Learning]] · [[Learning/Memory palace|Memory palace]]");
    expect(text.startsWith("---\n")).toBe(true);
  });

  it("omits review fields and the link line when there is nothing to add", () => {
    const text = serializeFiledNote(capture, {
      answers: { folder: "Learning", kind: "fact", importance: 1 },
      links: [],
      reviewDays: 0,
    });
    expect(text).not.toContain("review_at");
    expect(text).not.toContain("Связано");
  });
});

describe("parseSharedSettings", () => {
  it("falls back to defaults for missing or broken data", () => {
    expect(parseSharedSettings(null).inboxFolder).toBe("ArchiVarious/Inbox");
    expect(parseSharedSettings("{broken").reviewDays).toBe(7);
    expect(parseSharedSettings('{"reviewDays":"x","surveyDelayMinutes":-1}').reviewDays).toBe(7);
  });

  it("reads valid plugin settings", () => {
    const s = parseSharedSettings(
      '{"inboxFolder":" In ","surveyDelayMinutes":1,"linkFolderHub":false,"feedback":{"A":{"x":2}},"other":1}',
    );
    expect(s).toMatchObject({ inboxFolder: "In", surveyDelayMinutes: 1, linkFolderHub: false });
    expect(s.feedback).toEqual({ A: { x: 2 } });
  });
});
