import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SourceDocument, SourceFragment } from "@archivarious/core";
import { chunks } from "./chunks";
import { LIMITS } from "./extract";

interface DoclingBlock {
  page: number;
  text: string;
  kind: string;
  bounds?: SourceFragment["bounds"];
}

/** Validate the process boundary before accepting text as citable evidence. */
export function normalizeDocling(value: unknown, native: SourceDocument): SourceDocument {
  if (!value || typeof value !== "object") throw new Error("Некорректный ответ Docling.");
  const data = value as {
    schemaVersion?: unknown;
    version?: unknown;
    pageCount?: unknown;
    blocks?: unknown;
    warnings?: unknown;
    reviewPages?: unknown;
  };
  if (
    data.schemaVersion !== 1 ||
    data.pageCount !== native.pageCount ||
    !Array.isArray(data.blocks) ||
    !Array.isArray(data.warnings) ||
    !data.warnings.every((w) => typeof w === "string") ||
    !Array.isArray(data.reviewPages) ||
    !data.reviewPages.every((p) => Number.isInteger(p) && p >= 1 && p <= native.pageCount)
  ) {
    throw new Error("Неверный контракт Docling или число страниц.");
  }
  const fragments: SourceFragment[] = [];
  const reviewPages = data.reviewPages;
  let total = 0;
  for (const block of data.blocks as DoclingBlock[]) {
    if (
      !block ||
      !Number.isInteger(block.page) ||
      block.page < 1 ||
      block.page > native.pageCount ||
      typeof block.text !== "string" ||
      typeof block.kind !== "string"
    ) {
      throw new Error("Неверный блок Docling.");
    }
    if (
      block.bounds &&
      (![block.bounds.left, block.bounds.top, block.bounds.right, block.bounds.bottom].every(Number.isFinite) ||
        !["TOPLEFT", "BOTTOMLEFT"].includes(block.bounds.origin))
    ) {
      throw new Error("Неверные координаты Docling.");
    }
    total += block.text.length;
    if (total > LIMITS.characters) throw new Error("Больше 120 000 символов. Разделите PDF: текст не обрезается.");
    for (const text of chunks(block.text, LIMITS.fragment)) {
      fragments.push({
        id: `p${block.page}-d${fragments.length + 1}`,
        page: block.page,
        text,
        kind: block.kind,
        bounds: block.bounds,
        method: "docling",
      });
    }
  }
  const pages = Array.from({ length: native.pageCount }, (_, index) => {
    const page = index + 1;
    const reasons: string[] = [];
    if (!fragments.some((f) => f.page === page && f.text.trim().length >= 12)) {
      reasons.push("нет достаточного распознанного текста");
    }
    if (reviewPages.includes(page)) reasons.push("визуальный блок или формула требуют проверки по оригиналу");
    return { page, status: reasons.length ? ("needs-review" as const) : ("read" as const), reasons };
  });
  return {
    ...native,
    fragments,
    warnings: [...data.warnings, ...pages.flatMap((p) => p.reasons.map((r) => `Страница ${p.page}: ${r}.`))],
    extraction: {
      engine: "docling",
      version: typeof data.version === "string" ? data.version : undefined,
      status: pages.some((p) => p.status === "needs-review") ? "partial" : "complete",
      pages,
    },
  };
}

export async function extractWithDocling(
  bytes: Uint8Array,
  native: SourceDocument,
  python = process.env.ARCHIVARIOUS_PYTHON ?? "python",
): Promise<SourceDocument> {
  const directory = await mkdtemp(join(tmpdir(), "archivarious-docling-"));
  try {
    const input = join(directory, "input.pdf");
    const output = join(directory, "result.json");
    await writeFile(input, bytes);
    const script = fileURLToPath(new URL("../python/convert.py", import.meta.url));
    await new Promise<void>((resolve, reject) => {
      // Never invoke a shell. Provider diagnostics are not included in errors.
      execFile(
        python,
        [script, input, output],
        { timeout: 300_000, maxBuffer: 1024 * 1024, windowsHide: true },
        (error) => {
          if (error) {
            reject(
              new Error(
                "Docling недоступен или обработка завершилась ошибкой. Проверьте Python, зависимости и модели.",
              ),
            );
          } else {
            resolve();
          }
        },
      );
    });
    if ((await stat(output)).size > 10 * 1024 * 1024) throw new Error("Ответ Docling превышает 10 МБ.");
    return normalizeDocling(JSON.parse(await readFile(output, "utf8")), native);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
