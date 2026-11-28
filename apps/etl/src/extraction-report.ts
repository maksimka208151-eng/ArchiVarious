import type { SourceDocument } from "@archivarious/core";

/** Status is readable even when there are no source fragments to display. */
export function renderExtraction(source: SourceDocument): string {
  const hasText = source.fragments.some((fragment) => fragment.text.trim().length >= 12);
  const pdf = source.mediaType === "application/pdf";
  const lines = [pdf ? "# Извлечение PDF" : "# Извлечённый текст", ""];
  if (!hasText) {
    lines.push(
      "> Текст не извлечён. Это не готовый результат обработки.",
      "",
      ...(pdf
        ? [
            "Для PDF из изображений требуется OCR. Установите Docling по инструкции docs/ETL.md,",
            "задайте ARCHIVARIOUS_PYTHON и повторите запуск с --extractor docling.",
            "--allow-partial не заменяет OCR и не разрешает конспект по пустому источнику.",
          ]
        : ["Добавьте содержательный текст в исходный документ."]),
      "",
    );
  } else if (source.extraction?.status === "partial") {
    lines.push("> PDF прочитан частично. Часть страниц или визуальных элементов требует проверки.", "");
  }
  for (const warning of source.warnings) lines.push(`> ${warning.replace(/\s+/g, " ")}`, "");
  for (const fragment of source.fragments) lines.push(`## ${fragment.id}`, "", fragment.text, "");
  return `${lines.join("\n")}\n`;
}
