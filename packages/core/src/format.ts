export interface FormattedText {
  title: string;
  body: string;
  tags: string[];
  links: string[];
}

const TAG_RE = /(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu;
const URL_RE = /https?:\/\/[^\s<>()]+/g;
const TITLE_MAX_WORDS = 8;

/**
 * "Light" formatting: the user's words stay theirs. We only normalise whitespace,
 * capitalise the first letter, and pull out tags, links and a short title.
 */
export function lightFormat(raw: string): FormattedText {
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd());

  const body = capitalizeFirst(
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );

  const tags = unique([...body.matchAll(TAG_RE)].map((m) => (m[1] ?? "").toLowerCase()));
  const links = unique(body.match(URL_RE) ?? []);

  return { title: deriveTitle(body), body, tags, links };
}

export function deriveTitle(body: string): string {
  const firstLine = body.split("\n").find((line) => line.trim() !== "") ?? "";
  const words = firstLine.replace(URL_RE, "").replace(TAG_RE, " ").split(/\s+/).filter(Boolean);
  const title = words.slice(0, TITLE_MAX_WORDS).join(" ");
  return (words.length > TITLE_MAX_WORDS ? `${title}…` : title).replace(/[.,;:!?]+$/u, "") || "Untitled";
}

function capitalizeFirst(text: string): string {
  return text.replace(/^\p{Ll}/u, (c) => c.toLocaleUpperCase());
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
