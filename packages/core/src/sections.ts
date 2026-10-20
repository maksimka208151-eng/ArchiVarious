/**
 * User-defined sections ("разделы"): folders the user created on purpose and wants offered in every survey,
 * even before they hold any notes. A section is a top-level folder (`Учеба`), a subsection is a folder
 * inside it (`Учеба/Математика`).
 *
 * The list lives in a plain Markdown note inside the vault, so the plugin and the widget app share it,
 * it syncs with the vault, and the user can edit it in Obsidian like any other note. One bullet per
 * section, nested bullets for subsections. Changing the path is a cross-app change (the widget's Rust
 * side has the same constant).
 */
export const SECTIONS_FILE = "ArchiVarious/Разделы.md";

const SECTIONS_HEADER = `# Разделы

Разделы, которые ArchiVarious всегда предлагает в опросе. Каждый пункт — папка в хранилище, вложенный пункт — подраздел. Список можно править вручную.
`;

const BULLET_RE = /^([ \t]*)[-*+][ \t]+(.+?)[ \t]*$/;

/** One path segment: no slashes, no leading dots (hidden folders), no characters Obsidian rejects in names. */
export function cleanSectionName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim();
}

/** `" Учеба / Математика "` → `"Учеба/Математика"`; empty segments are dropped. */
export function sectionPath(path: string): string {
  return path.split(/[\\/]/).map(cleanSectionName).filter(Boolean).join("/");
}

/** Section paths from the list note: `["Учеба", "Учеба/Математика", "Работа"]`, parents before children, no duplicates. */
export function parseSections(markdown: string | null | undefined): string[] {
  const paths: string[] = [];
  // Indentation of each open list level and the path at that level.
  const stack: { indent: number; path: string }[] = [];
  for (const line of (markdown ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const m = BULLET_RE.exec(line);
    if (!m) continue;
    const indent = (m[1] ?? "").replace(/\t/g, "    ").length;
    const name = sectionPath(m[2] ?? "");
    if (!name) continue;
    while (stack.length > 0 && (stack[stack.length - 1]?.indent ?? 0) >= indent) stack.pop();
    const parent = stack[stack.length - 1]?.path;
    const path = parent ? `${parent}/${name}` : name;
    stack.push({ indent, path });
    for (const p of withParents(path)) if (!paths.includes(p)) paths.push(p);
  }
  return paths;
}

/** The list note for these sections: a header and a nested bullet list, in the given order. */
export function serializeSections(sections: string[]): string {
  const lines: string[] = [];
  for (const path of normalizeSections(sections)) {
    const parts = path.split("/");
    lines.push(`${"  ".repeat(parts.length - 1)}- ${parts[parts.length - 1]}`);
  }
  return `${SECTIONS_HEADER}\n${lines.join("\n")}\n`;
}

/** Adds a section (and its parents). Returns the same array when nothing changed, so callers can skip a write. */
export function addSection(sections: string[], path: string): string[] {
  const clean = sectionPath(path);
  if (!clean) return sections;
  const missing = withParents(clean).filter((p) => !sections.includes(p));
  return missing.length > 0 ? normalizeSections([...sections, ...missing]) : sections;
}

/**
 * Every path with its parents, each child right after its parent: existing order is kept for top-level
 * sections and among siblings, so the list note reads like the user wrote it.
 */
function normalizeSections(sections: string[]): string[] {
  const all: string[] = [];
  for (const s of sections) {
    for (const p of withParents(sectionPath(s))) if (p && !all.includes(p)) all.push(p);
  }
  const children = (parent: string) =>
    all.filter((p) => p.lastIndexOf("/") === parent.length && p.startsWith(`${parent}/`));
  const walk = (path: string): string[] => [path, ...children(path).flatMap(walk)];
  return all.filter((p) => !p.includes("/")).flatMap(walk);
}

function withParents(path: string): string[] {
  const parts = path.split("/").filter(Boolean);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}
