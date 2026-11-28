import { createHash } from "node:crypto";
import type { SourceDocument, SourceFragment } from "@archivarious/core";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { chunks } from "./chunks";

export const LIMITS = { bytes: 30 * 1024 * 1024, pages: 150, characters: 120_000, fragment: 6_000 };

export function extractText(
  bytes: Uint8Array,
  name: string,
  mediaType: "text/plain" | "text/markdown",
): SourceDocument {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Не удалось прочитать текст. Сохраните документ в кодировке UTF-8.");
  }
  if (text.includes("\0")) throw new Error("Файл содержит двоичные данные. Ожидается текст UTF-8.");
  if (text.length > LIMITS.characters) throw new Error("Больше 120 000 символов. Разделите документ.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return {
    schemaVersion: 1,
    id: sha256,
    name,
    mediaType,
    sha256,
    pageCount: 1,
    fragments: chunks(text, LIMITS.fragment).map((part, index) => ({
      id: `f${index + 1}`,
      page: 1,
      text: part,
      method: "native",
    })),
    warnings: mediaType === "text/markdown" ? ["Вложения и связанные файлы Markdown не анализируются."] : [],
  };
}

/** PDF.js text extraction plus conservative signals for the hybrid router. */
export async function extractPdf(bytes: Uint8Array, name: string, allowEmpty = false): Promise<SourceDocument> {
  if (bytes.byteLength > LIMITS.bytes) throw new Error("PDF превышает лимит 30 МБ.");
  const header = new TextDecoder().decode(bytes.slice(0, 1024));
  if (!header.includes("%PDF-")) throw new Error("Файл не является PDF.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > LIMITS.pages) throw new Error("В PDF больше 150 страниц. Разделите документ.");
    const fragments: SourceFragment[] = [];
    const warnings: string[] = [];
    const pages: NonNullable<SourceDocument["extraction"]>["pages"] = [];
    let total = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const current = await pdf.getPage(page);
      const content = await current.getTextContent();
      const operators = await current.getOperatorList();
      const text = content.items
        .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""))
        .join("")
        .trim();
      total += text.length;
      if (total > LIMITS.characters) throw new Error("Больше 120 000 символов. Разделите PDF: текст не обрезается.");
      const reasons: string[] = [];
      if (text.replace(/\s/g, "").length < 40) reasons.push("мало текста; требуется проверка/OCR");
      if (text.includes("\uFFFD") || [...text].some((character) => character.charCodeAt(0) <= 8)) {
        reasons.push("повреждённый текстовый слой");
      }
      const imageOps: number[] = [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject];
      if (operators.fnArray.some((op: number) => imageOps.includes(op))) reasons.push("изображения не прочитаны");
      const rows = new Map<number, number[]>();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const y = Math.round((item.transform[5] ?? 0) / 3);
        const xs = rows.get(y) ?? [];
        xs.push(item.transform[4] ?? 0);
        rows.set(y, xs);
      }
      const width = (current.view[2] ?? 0) - (current.view[0] ?? 0);
      const splitRows = [...rows.values()].filter((xs) => Math.max(...xs) - Math.min(...xs) > width * 0.35);
      if (splitRows.length >= 3) reasons.push("возможны колонки или таблица");
      pages.push({ page, status: reasons.length ? "needs-review" : "read", reasons });
      warnings.push(...reasons.map((reason) => `Страница ${page}: ${reason}.`));
      for (const [index, part] of chunks(text, LIMITS.fragment).entries()) {
        fragments.push({ id: `p${page}-f${index + 1}`, page, text: part, method: "native" });
      }
      current.cleanup();
    }
    if (!allowEmpty && !fragments.some((fragment) => fragment.text.length >= 12)) {
      throw new Error("Нет доступного текста. Для сканированного PDF нужен OCR.");
    }
    return {
      schemaVersion: 1,
      id: sha256,
      name,
      mediaType: "application/pdf",
      sha256,
      pageCount: pdf.numPages,
      fragments,
      warnings,
      extraction: {
        engine: "pdfjs",
        status: pages.some((p) => p.status === "needs-review") ? "partial" : "complete",
        pages,
      },
    };
  } finally {
    await task.destroy();
  }
}
