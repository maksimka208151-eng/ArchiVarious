import type { SourceDocument } from "@archivarious/core";
import { DoclingError, type DoclingOptions, extractWithDocling, validateOcrOptions } from "./docling";
import { extractPdf } from "./extract";

export type ExtractorMode = "auto" | "pdfjs" | "docling";
export interface ExtractionOptions extends DoclingOptions {
  extractor?: ExtractorMode;
  allowPartial?: boolean;
}
type DoclingRunner = (bytes: Uint8Array, native: SourceDocument, options: DoclingOptions) => Promise<SourceDocument>;

export async function extractDocument(
  bytes: Uint8Array,
  name: string,
  options: ExtractionOptions = {},
  docling: DoclingRunner = extractWithDocling,
): Promise<SourceDocument> {
  const mode = options.extractor ?? "auto";
  if (!["auto", "pdfjs", "docling"].includes(mode)) throw new Error("Выберите auto, pdfjs или docling.");
  validateOcrOptions(options);
  const native = await extractPdf(bytes, name, true);
  if (mode === "pdfjs" || (mode === "auto" && native.extraction?.status === "complete")) return native;
  try {
    return await docling(bytes, native, options);
  } catch (error) {
    if (mode === "docling") throw error;
    return {
      ...native,
      warnings: [
        ...native.warnings,
        "Docling не завершил обработку: сохранён неполный результат PDF.js. Настройте Docling и повторите запуск.",
        ...(error instanceof DoclingError ? [error.message] : []),
      ],
      extraction: {
        engine: "pdfjs",
        status: "partial",
        pages: native.extraction?.pages ?? [],
      },
    };
  }
}
