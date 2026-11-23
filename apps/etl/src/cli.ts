import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { SourceDocument } from "@archivarious/core";
import type { DoclingOptions } from "./docling";
import type { ExtractorMode } from "./hybrid";
import { LOCAL_MODEL, localEndpoint, summarizeLocal } from "./local-summarize";
import { runPipeline, type Summarizer } from "./pipeline";

const help = `ArchiVarious — PDF → извлечённый текст → конспект с доказательствами

pnpm etl --input ./lecture.pdf --output ./knowledge
pnpm etl --input ./lecture.pdf --output ./knowledge --model provider/model

Без --model и --provider local нейросеть не вызывается.
--provider local: локальный OpenAI-совместимый сервер, модель по умолчанию qwen3.5-9b.
--endpoint http://127.0.0.1:8080/v1: адрес локального сервера (только loopback).
--batch-chars 6000: размер части текста; это символы, а не токены контекста.
--llm-timeout 600: таймаут каждой части в секундах.
Пример: pnpm etl --input ./lecture.pdf --output ./knowledge --provider local
--model отправляет извлечённый текст выбранной модели через AI Gateway.
Нужен AI_GATEWAY_API_KEY в окружении. Название доступной модели задайте явно.
Оригинал, текст и результаты сохраняются в новой папке внутри --output.
--extractor auto|pdfjs|docling: по умолчанию auto, Docling для подозрительных PDF.
--allow-partial разрешает конспект с явно отмеченными пропусками.
--ocr-engine easyocr|tesseract: движок внутри Docling (по умолчанию easyocr).
--ocr-timeout 900: лимит времени OCR в секундах, по умолчанию 300.
--ocr-scale 2: масштаб рендера для OCR (1–4), по умолчанию 3.
Docling: отдельный Python; путь задаётся ARCHIVARIOUS_PYTHON.
Лимиты: 30 МБ, 150 страниц, 120 000 символов.
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      output: { type: "string" },
      model: { type: "string" },
      provider: { type: "string", default: "gateway" },
      endpoint: { type: "string" },
      "batch-chars": { type: "string", default: "6000" },
      "llm-timeout": { type: "string", default: "600" },
      help: { type: "boolean" },
      extractor: { type: "string", default: "auto" },
      "allow-partial": { type: "boolean", default: false },
      "ocr-engine": { type: "string", default: "easyocr" },
      "ocr-timeout": { type: "string", default: "300" },
      "ocr-scale": { type: "string", default: "3" },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (!values.input || !values.output) throw new Error("Укажите --input и --output. Справка: pnpm etl --help");
  if (!["auto", "pdfjs", "docling"].includes(values.extractor)) {
    throw new Error("--extractor: auto, pdfjs или docling.");
  }
  if (!["gateway", "local"].includes(values.provider)) throw new Error("--provider: gateway или local.");
  const local = values.provider === "local";
  if (!local && values.endpoint) throw new Error("--endpoint используется с --provider local.");
  if (!local && values.model && (!values.model.includes("/") || !process.env.AI_GATEWAY_API_KEY)) {
    throw new Error("Для генерации нужны --model provider/model и AI_GATEWAY_API_KEY в окружении.");
  }
  const batchCharacters = Number(values["batch-chars"]);
  const timeoutSeconds = Number(values["llm-timeout"]);
  if (!Number.isInteger(batchCharacters) || batchCharacters < 1000 || batchCharacters > 12000) {
    throw new Error("--batch-chars: целое число от 1000 до 12000.");
  }
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 3600) {
    throw new Error("--llm-timeout: целое число от 1 до 3600.");
  }
  if (local) localEndpoint(values.endpoint);
  const model = values.model ?? (local ? LOCAL_MODEL : undefined);
  const summarizer: Summarizer | undefined = local
    ? (source, context) =>
        summarizeLocal(source, {
          model,
          endpoint: values.endpoint,
          batchCharacters,
          timeoutSeconds,
          onBatch: context.save,
        })
    : model
      ? async (source) => {
          const { summarizeSource } = await import("./summarize");
          return summarizeSource(source, model);
        }
      : undefined;
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const directory = await runPipeline(resolve(cwd, values.input), resolve(cwd, values.output), summarizer, model, {
    generation: model
      ? {
          provider: values.provider,
          ...(local
            ? { endpoint: values.endpoint ?? "http://127.0.0.1:8080/v1", batchCharacters, timeoutSeconds }
            : {}),
        }
      : undefined,
    extractor: values.extractor as ExtractorMode,
    allowPartial: values["allow-partial"],
    ocrEngine: values["ocr-engine"] as DoclingOptions["ocrEngine"],
    timeoutSeconds: Number(values["ocr-timeout"]),
    ocrScale: Number(values["ocr-scale"]),
  });
  console.log(`Результат сохранён: ${directory}. Проверьте статус в run.json и предупреждения в source.json.`);
  const source = JSON.parse(await readFile(resolve(directory, "source.json"), "utf8")) as SourceDocument;
  console.log(`Извлечено символов: ${source.fragments.reduce((total, fragment) => total + fragment.text.length, 0)}.`);
  if (source.extraction?.status === "partial") {
    console.warn("Внимание: PDF прочитан частично. Откройте extracted.md: там указаны пропуски и причины.");
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Не удалось обработать документ.");
  process.exitCode = 1;
});
