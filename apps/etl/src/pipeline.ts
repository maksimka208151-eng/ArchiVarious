import { randomUUID } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  type GroundedSummary,
  renderGroundedMarkdown,
  type SourceDocument,
  validateEvidence,
} from "@archivarious/core";
import { LIMITS } from "./extract";
import { extractDocument, type ExtractionOptions } from "./hybrid";

export type Summarizer = (source: SourceDocument) => Promise<GroundedSummary>;

export async function runPipeline(
  input: string,
  outputRoot: string,
  summarize?: Summarizer,
  model?: string,
  options: ExtractionOptions = {},
): Promise<string> {
  const file = await open(resolve(input), "r");
  let bytes: Uint8Array;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > LIMITS.bytes) throw new Error("Нужен PDF-файл размером до 30 МБ.");
    bytes = await file.readFile();
  } finally {
    await file.close();
  }
  // New directory per attempt: a failed or repeated run cannot overwrite earlier results.
  const directory = join(resolve(outputRoot), randomUUID());
  await mkdir(directory, { recursive: true });
  const save = (name: string, value: unknown) =>
    writeFile(join(directory, name), `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await writeFile(join(directory, "original.pdf"), bytes, { flag: "wx" });
  let source: SourceDocument;
  try {
    source = await extractDocument(bytes, basename(input), options);
  } catch (error) {
    await save("failed.json", {
      status: "failed",
      stage: "extraction",
      message: "Не удалось извлечь PDF; оригинал сохранён.",
    });
    throw new Error(`Не удалось извлечь PDF. Данные сохранены: ${directory}`, { cause: error });
  }
  await save("source.json", source);
  await writeFile(
    join(directory, "extracted.md"),
    source.fragments.map((fragment) => `## ${fragment.id}\n\n${fragment.text}\n`).join("\n"),
    { flag: "wx" },
  );
  const startedAt = new Date().toISOString();
  await save("run.json", {
    schemaVersion: 1,
    sourceId: source.id,
    startedAt,
    model: model ?? null,
    extractor: source.extraction,
    status: source.extraction?.status === "partial" ? "partial" : summarize ? "generating" : "extracted",
  });
  if (!summarize) return directory;
  const blocked = source.extraction?.status === "partial" && !options.allowPartial;
  try {
    if (blocked) throw new Error("PDF прочитан частично; требуется проверка или --allow-partial.");
    const summary = await summarize(source);
    validateEvidence(summary, source);
    await save("summary.json", summary);
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
      : "Не удалось создать проверяемый конспект.";
    throw new Error(`${message} Данные сохранены: ${directory}`, { cause: error });
  }
  return directory;
}
