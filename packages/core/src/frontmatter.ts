/**
 * Minimal frontmatter access for hosts without Obsidian's metadata cache (the widget app). Only flat
 * `key: value` lines are read and written; lists and nested YAML are left exactly as they are.
 */

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;

/** Flat `key: value` pairs, with JSON-quoted strings unquoted. */
export function readFrontmatter(markdown: string): Record<string, string> {
  const fm = FRONTMATTER_RE.exec(markdown.replace(/\r\n?/g, "\n"));
  const fields: Record<string, string> = {};
  for (const line of (fm?.[1] ?? "").split("\n")) {
    const m = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!m?.[1]) continue;
    fields[m[1]] = unquote((m[2] ?? "").trim());
  }
  return fields;
}

/**
 * Sets (or with `null` removes) flat fields, keeping every other line as it was. Strings are written
 * JSON-quoted, numbers and booleans as is. A note without frontmatter gets one.
 */
export function setFrontmatter(markdown: string, fields: Record<string, string | number | boolean | null>): string {
  const text = markdown.replace(/\r\n?/g, "\n");
  const fm = FRONTMATTER_RE.exec(text);
  const lines = fm ? (fm[1] ?? "").split("\n") : [];
  const body = fm ? text.slice(fm[0].length) : text;
  const rest = new Map(Object.entries(fields));

  const out: string[] = [];
  for (const line of lines) {
    const key = /^([A-Za-z_][\w-]*):/.exec(line)?.[1];
    if (key === undefined || !rest.has(key)) {
      out.push(line);
      continue;
    }
    const value = rest.get(key);
    rest.delete(key);
    if (value !== null && value !== undefined) out.push(`${key}: ${format(value)}`);
  }
  for (const [key, value] of rest) if (value !== null) out.push(`${key}: ${format(value)}`);

  if (out.length === 0) return body.replace(/^\n/, "");
  return `---\n${out.join("\n")}\n---\n${fm ? body : `\n${body}`}`;
}

function format(value: string | number | boolean): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function unquote(value: string): string {
  if (value.startsWith('"')) {
    try {
      return String(JSON.parse(value));
    } catch {
      return value;
    }
  }
  return value.replace(/^'(.*)'$/, "$1");
}
