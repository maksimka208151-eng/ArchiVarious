/** Versioned, platform-independent contract between extractors, synthesis and exports. */
export interface SourceDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  mediaType: "application/pdf";
  sha256: string;
  pageCount: number;
  fragments: SourceFragment[];
  warnings: string[];
}

export interface SourceFragment {
  id: string;
  page: number;
  text: string;
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
  for (const warning of source.warnings) lines.push(`> ${escapeMarkdown(warning)}`, "");
  for (const claim of summary.claims) {
    lines.push(`- ${escapeMarkdown(claim.text.replace(/\s+/g, " "))}`);
    for (const evidence of claim.evidence) {
      const page = fragments.get(evidence.fragmentId)?.page;
      lines.push(
        `  - [Страница ${page}](./original.pdf#page=${page}) · [Извлечённый текст](./extracted.md#${evidence.fragmentId})`,
        `    > ${escapeMarkdown(evidence.quote.replace(/\s+/g, " "))}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}
