/** Versioned, platform-independent contract between extractors, synthesis and exports. */
export interface SourceDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  mediaType: "application/pdf" | "text/plain" | "text/markdown";
  sha256: string;
  pageCount: number;
  fragments: SourceFragment[];
  warnings: string[];
  /** Optional for compatibility with earlier source exports. */
  extraction?: {
    engine: "pdfjs" | "docling";
    ocrEngine?: "easyocr" | "tesseract";
    version?: string;
    status: "complete" | "partial";
    pages: { page: number; status: "read" | "needs-review"; reasons: string[] }[];
  };
}

export function originalDocumentName(mediaType: SourceDocument["mediaType"]): string {
  if (mediaType === "text/plain") return "original.txt";
  if (mediaType === "text/markdown") return "original.md";
  return "original.pdf";
}

export interface SourceFragment {
  id: string;
  page: number;
  text: string;
  kind?: string;
  bounds?: { left: number; top: number; right: number; bottom: number; origin: string };
  method?: "native" | "docling";
}

export interface Evidence {
  fragmentId: string;
  quote: string;
}

export interface GroundedClaim {
  text: string;
  evidence: Evidence[];
}

export interface GroundedSummary {
  title: string;
  claims: GroundedClaim[];
  /** Mechanical accounting only; does not establish semantic coverage or accuracy. */
  coverage?: {
    parts: number;
    processedFragmentIds: string[];
    citedFragmentIds: string[];
    uncitedFragmentIds: string[];
  };
}

/** Checks traceability, not whether the quotation logically proves the claim. */
export function validateEvidence(summary: GroundedSummary, source: SourceDocument): void {
  if (!summary.title.trim() || summary.claims.length === 0) throw new Error("Конспект пуст.");
  const fragments = new Map(source.fragments.map((fragment) => [fragment.id, fragment]));
  for (const claim of summary.claims) {
    if (!claim.text.trim() || claim.evidence.length === 0) throw new Error("Тезис без доказательств.");
    for (const evidence of claim.evidence) {
      const fragment = fragments.get(evidence.fragmentId);
      if (!fragment || evidence.quote.trim().length < 12 || !fragment.text.includes(evidence.quote)) {
        throw new Error(`Непроверяемая цитата: ${evidence.fragmentId}`);
      }
    }
  }
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]<>#!|]/g, "\\$&");
}

/** All links are built locally from verified fragment IDs; the model cannot supply URLs. */
export function renderGroundedMarkdown(summary: GroundedSummary, source: SourceDocument): string {
  validateEvidence(summary, source);
  const fragments = new Map(source.fragments.map((fragment) => [fragment.id, fragment]));
  const lines = [
    `# ${escapeMarkdown(summary.title)}`,
    "",
    `Источник: ${escapeMarkdown(source.name)}`,
    "",
    "Черновик ИИ. Ссылки и точность цитат проверены программно; смысл тезисов требует проверки по оригиналу.",
    "",
  ];
  if (source.extraction?.status === "partial") {
    lines.push("> PDF обработан частично. Конспект не охватывает все страницы или визуальные элементы.", "");
  }
  if (summary.coverage) {
    lines.push(
      `Обработано частей: ${summary.coverage.parts}. Фрагментов без цитат: ${summary.coverage.uncitedFragmentIds.length}. Наличие цитаты не доказывает полноту или правильность тезиса.`,
      "",
    );
  }
  for (const warning of source.warnings) lines.push(`> ${escapeMarkdown(warning)}`, "");
  for (const claim of summary.claims) {
    lines.push(`- ${escapeMarkdown(claim.text.replace(/\s+/g, " "))}`);
    for (const evidence of claim.evidence) {
      const page = fragments.get(evidence.fragmentId)?.page;
      const original =
        source.mediaType === "application/pdf"
          ? `[Страница ${page}](./original.pdf#page=${page})`
          : `[Оригинал](./${originalDocumentName(source.mediaType)})`;
      lines.push(
        `  - ${original} · [Извлечённый текст](./extracted.md#${evidence.fragmentId})`,
        `    > ${escapeMarkdown(evidence.quote.replace(/\s+/g, " "))}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
