import { randomUUID } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
  type GroundedSummary,
  originalDocumentName,
  renderGroundedMarkdown,
  type SourceDocument,
  validateEvidence,
} from "@archivarious/core";
import { DoclingError } from "./docling";
import { extractText, LIMITS } from "./extract";
import { renderExtraction } from "./extraction-report";
import { type ExtractionOptions, extractDocument } from "./hybrid";
import { LocalModelError } from "./local-summarize";

export type Summarizer = (
  source: SourceDocument,
  context: { save: (name: string, value: unknown) => Promise<void> },
) => Promise<GroundedSummary>;

export async function runPipeline(
  input: string,
  outputRoot: string,
  summarize?: Summarizer,
  model?: string,
  options: ExtractionOptions & {
    generation?: { provider: string; endpoint?: string; batchCharacters?: number; timeoutSeconds?: number };
    onDirectory?: (path: string) => void;
  } = {},
): Promise<string> {
  const file = await open(resolve(input), "r");
  let bytes: Uint8Array;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > LIMITS.bytes) throw new Error("Нужен файл размером до 30 МБ.");
    bytes = await file.readFile();
  } finally {
    await file.close();
  }
  // New directory per attempt: a failed or repeated run cannot overwrite earlier results.
  const directory = join(resolve(outputRoot), randomUUID());
  await mkdir(directory, { recursive: true });
  options.onDirectory?.(directory);
  const save = (name: string, value: unknown) =>
    writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  const extension = extname(input).toLowerCase();
  const mediaType = extension === ".txt" ? "text/plain" : extension === ".md" ? "text/markdown" : "application/pdf";
  await writeFile(join(directory, originalDocumentName(mediaType)), bytes, { flag: "wx" });
  let source: SourceDocument;
  try {
    source =
      mediaType === "application/pdf"
        ? await extractDocument(bytes, basename(input), options)
        : extractText(bytes, basename(input), mediaType);
  } catch (error) {
    const message =
      error instanceof DoclingError || (mediaType !== "application/pdf" && error instanceof Error)
        ? error.message
        : "Не удалось извлечь PDF; оригинал сохранён.";
    await save("failed.json", {
      status: "failed",
      stage: "extraction",
      message,
    });
    throw new Error(`${message} Данные сохранены: ${directory}`, { cause: error });
  }
  await save("source.json", source);
  await writeFile(join(directory, "extracted.md"), renderExtraction(source), { flag: "wx" });
  const hasText = source.fragments.some((fragment) => fragment.text.trim().length >= 12);
  const startedAt = new Date().toISOString();
  await save("run.json", {
    schemaVersion: 1,
    sourceId: source.id,
    startedAt,
    model: model ?? null,
    generation: options.generation ?? null,
    extractor: source.extraction,
    ocrEngine: options.ocrEngine ?? "easyocr",
    ocrTimeoutSeconds: options.timeoutSeconds ?? 300,
    ocrScale: options.ocrScale ?? 3,
    status: !hasText
      ? "failed"
      : source.extraction?.status === "partial"
        ? "partial"
        : summarize
          ? "generating"
          : "extracted",
  });
  if (!hasText) {
    const message =
      mediaType === "application/pdf"
        ? "Текст не извлечён: требуется работающий OCR. См. extracted.md и docs/ETL.md; повторите с --extractor docling."
        : "В документе недостаточно текста для конспекта. См. extracted.md.";
    await save("failed.json", { status: "failed", stage: "extraction", message });
    throw new Error(`${message} Данные сохранены: ${directory}`);
  }
  if (!summarize) return directory;
  const blocked = source.extraction?.status === "partial" && !options.allowPartial;
  try {
    if (blocked) throw new Error("PDF прочитан частично; требуется проверка или --allow-partial.");
    const summary = await summarize(source, { save });
    validateEvidence(summary, source);
    await save("summary.json", summary);
    if (summary.coverage) await save("coverage.json", summary.coverage);
    await writeFile(join(directory, "summary.md"), renderGroundedMarkdown(summary, source), { flag: "wx" });
    await save("completed.json", {
      completedAt: new Date().toISOString(),
      status: source.extraction?.status === "partial" ? "partial" : "complete",
    });
  } catch (error) {
    // Provider errors can contain credentials or source text; keep the persisted failure generic.
    await save("failed.json", {
      failedAt: new Date().toISOString(),
      status: "failed",
      message: "Конспект не создан или не прошёл проверку. Оригинал и извлечённый текст сохранены.",
    });
    const message = blocked
      ? "PDF прочитан частично. Проверьте source.json; --allow-partial разрешает конспект с пропусками."
      : error instanceof LocalModelError
        ? error.message
        : "Не удалось создать проверяемый конспект.";
    throw new Error(`${message} Данные сохранены: ${directory}`, { cause: error });
  }
  return directory;
}
