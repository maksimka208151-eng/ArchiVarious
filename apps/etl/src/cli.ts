import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { SourceDocument } from "@archivarious/core";
import { runPipeline } from "./pipeline";

const help = `ArchiVarious — PDF → извлечённый текст → конспект с доказательствами

pnpm etl --input ./lecture.pdf --output ./knowledge
pnpm etl --input ./lecture.pdf --output ./knowledge --model provider/model

Без --model всё выполняется локально, нейросеть не вызывается.
--model отправляет извлечённый текст выбранной модели через AI Gateway.
Нужен AI_GATEWAY_API_KEY в окружении. Название доступной модели задайте явно.
Оригинал, текст и результаты сохраняются в новой папке внутри --output.
Лимиты: 30 МБ, 150 страниц, 120 000 символов. OCR пока не поддерживается.
`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      input: { type: "string" },
      output: { type: "string" },
      model: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(help);
    return;
  }
  if (!values.input || !values.output) throw new Error("Укажите --input и --output. Справка: pnpm etl --help");
  if (values.model && (!values.model.includes("/") || !process.env.AI_GATEWAY_API_KEY)) {
    throw new Error("Для генерации нужны --model provider/model и AI_GATEWAY_API_KEY в окружении.");
  }
  const model = values.model;
  const summarizer = model
    ? async (source: SourceDocument) => {
        const { summarizeSource } = await import("./summarize");
        return summarizeSource(source, model);
      }
    : undefined;
  const cwd = process.env.INIT_CWD ?? process.cwd();
  const directory = await runPipeline(resolve(cwd, values.input), resolve(cwd, values.output), summarizer, model);
  console.log(`${model ? "Конспект создан" : "Текст извлечён локально"}: ${directory}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Не удалось обработать документ.");
  process.exitCode = 1;
});
