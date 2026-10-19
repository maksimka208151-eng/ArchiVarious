import type { Capture, CaptureSource, CaptureStatus } from "./capture";
import { createId } from "./capture";
import { lightFormat } from "./format";
import { DEFAULT_SURVEY_POLICY, type SurveyPolicy, scheduleSurvey } from "./schedule";

/**
 * Inbox protocol: the contract between every capture surface (widget app, plugin, URI) and the plugin.
 * A capture is one Markdown file with YAML frontmatter inside the vault's inbox folder.
 * Plain files work with any sync (Obsidian Sync, iCloud, Syncthing, git) and need no server.
 */
export const INBOX_PROTOCOL_VERSION = 1;
export const DEFAULT_INBOX_FOLDER = "ArchiVarious/Inbox";
export const URI_ACTION = "archivarious";

export function newCapture(
  raw: string,
  source: CaptureSource,
  now: Date = new Date(),
  policy: SurveyPolicy = DEFAULT_SURVEY_POLICY,
): Capture {
  const { title, body, tags, links } = lightFormat(raw);
  return {
    id: createId(now),
    raw,
    title,
    body,
    tags,
    links,
    source,
    status: "inbox",
    createdAt: now.toISOString(),
    surveyAt: scheduleSurvey(now, policy).toISOString(),
  };
}

export function captureFileName(capture: Capture): string {
  const stamp = capture.createdAt.replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
  return `${stamp}-${capture.id}.md`;
}

export function serializeCapture(capture: Capture): string {
  const fm = [
    "---",
    `archivarious: ${INBOX_PROTOCOL_VERSION}`,
    `id: ${capture.id}`,
    `title: ${JSON.stringify(capture.title)}`,
    `source: ${capture.source}`,
    `status: ${capture.status}`,
    `created: ${capture.createdAt}`,
    `survey_at: ${capture.surveyAt}`,
    `tags: [${capture.tags.map((t) => JSON.stringify(t)).join(", ")}]`,
    `links: [${capture.links.map((l) => JSON.stringify(l)).join(", ")}]`,
    `raw: ${JSON.stringify(capture.raw)}`,
    "---",
  ];
  return `${fm.join("\n")}\n\n${capture.body}\n`;
}

/**
 * Parses a file written by `serializeCapture`. Only the flat subset of YAML we emit is supported;
 * values are JSON-encoded where they could contain special characters, so `JSON.parse` is enough.
 */
export function parseCapture(markdown: string): Capture | null {
  const match = /^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/.exec(markdown.replace(/\r\n?/g, "\n"));
  if (!match) return null;
  const fields = new Map<string, string>();
  for (const line of (match[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fields.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  if (!fields.has("archivarious") || !fields.get("id")) return null;

  return {
    id: fields.get("id") ?? "",
    raw: decode(fields.get("raw"), ""),
    title: decode(fields.get("title"), ""),
    body: (match[2] ?? "").replace(/\n$/, ""),
    tags: decode<string[]>(fields.get("tags"), []),
    links: decode<string[]>(fields.get("links"), []),
    source: (fields.get("source") ?? "plugin") as CaptureSource,
    status: (fields.get("status") ?? "inbox") as CaptureStatus,
    createdAt: fields.get("created") ?? "",
    surveyAt: fields.get("survey_at") ?? "",
  };
}

/** `obsidian://archivarious?text=…` — instant capture from any app that can open a URL (mobile widgets, shortcuts). */
export function buildCaptureUri(text: string, source: CaptureSource = "uri", vault?: string): string {
  // Built by hand rather than with URLSearchParams so core needs no DOM/Node typings.
  const params: [string, string][] = [
    ["text", text],
    ["source", source],
  ];
  if (vault) params.push(["vault", vault]);
  const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  return `obsidian://${URI_ACTION}?${query}`;
}

function decode<T>(value: string | undefined, fallback: T): T {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
