import { createHash } from "node:crypto";
import type { SourceDocument, SourceFragment } from "@archivarious/core";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const LIMITS = { bytes: 30 * 1024 * 1024, pages: 150, characters: 120_000, fragment: 6_000 };

/** Text PDFs only: no OCR or inferred reading order for complex layouts in this first slice. */
export async function extractPdf(bytes: Uint8Array, name: string): Promise<SourceDocument> {
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
    let total = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const current = await pdf.getPage(page);
      const content = await current.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : ""))
        .join("")
        .trim();
      total += text.length;
      if (total > LIMITS.characters) throw new Error("Больше 120 000 символов. Разделите PDF: текст не обрезается.");
      if (text.length < 12) warnings.push(`Страница ${page}: мало текста; изображения и сканы требуют OCR.`);
      for (let offset = 0; offset < text.length; offset += LIMITS.fragment) {
        fragments.push({
          id: `p${page}-f${Math.floor(offset / LIMITS.fragment) + 1}`,
          page,
          text: text.slice(offset, offset + LIMITS.fragment),
        });
      }
      current.cleanup();
    }
    if (!fragments.some((fragment) => fragment.text.length >= 12)) {
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
    };
  } finally {
    await task.destroy();
  }
}
