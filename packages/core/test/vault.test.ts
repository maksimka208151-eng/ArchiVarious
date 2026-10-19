import { describe, expect, it } from "vitest";
import { snapshotFromSnippets } from "../src/vault";

const snippets = [
  { path: "Learning/Memory palace.md", text: "---\ntags: [Memory, study]\n---\n# Method of loci\nbody #recall" },
  { path: "Learning/Speed reading.md", text: "---\ntags:\n  - books\n---\nbody" },
  { path: "Work/Plan.md", text: "tags: not frontmatter\n## Roadmap\r\nQ3 #Project" },
  { path: "ArchiVarious/Inbox/2026-x.md", text: "#ignored" },
  { path: "Root note.md", text: "#rootonly" },
];

describe("snapshotFromSnippets", () => {
  const { index, notes } = snapshotFromSnippets(snippets, "ArchiVarious/Inbox");

  it("profiles folders from frontmatter and inline tags and from titles and headings", () => {
    const learning = index.folders.find((f) => f.path === "Learning");
    expect(learning?.noteCount).toBe(2);
    expect(learning?.tags).toEqual({ memory: 1, study: 1, recall: 1, books: 1 });
    expect(learning?.terms).toMatchObject({ memory: 1, palace: 1, method: 1, loci: 1, speed: 1, reading: 1 });
  });

  it("ignores the inbox and the vault root for folder votes", () => {
    expect(index.folders.map((f) => f.path).sort()).toEqual(["Learning", "Work"]);
    expect(notes.map((n) => n.path)).not.toContain("ArchiVarious/Inbox/2026-x.md");
  });

  it("keeps root notes as link targets", () => {
    expect(notes.find((n) => n.path === "Root note.md")).toMatchObject({ title: "Root note", tags: ["rootonly"] });
  });

  it("only reads frontmatter tags from real frontmatter and handles CRLF", () => {
    const work = index.folders.find((f) => f.path === "Work");
    expect(work?.tags).toEqual({ project: 1 });
    expect(work?.terms).toMatchObject({ roadmap: 1, plan: 1 });
  });
});
