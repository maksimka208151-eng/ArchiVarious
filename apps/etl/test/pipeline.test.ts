import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractPdf } from "../src/extract";
import { runPipeline } from "../src/pipeline";

/** Small real PDF with accurate xref offsets, no external fixture dependencies. */
function pdfFixture(text = "Revenue increased by fifteen percent."): Uint8Array {
  const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), "archivarious-etl-"));
  temporary.push(root);
  const input = join(root, "input.pdf");
  const bytes = pdfFixture();
  await writeFile(input, bytes);
  return { root, input, bytes, output: join(root, "output") };
}

describe("PDF pipeline", () => {
  it("extracts a real PDF with page references and deterministic content hash", async () => {
    const source = await extractPdf(pdfFixture(), "input.pdf");
    expect(source.fragments[0]).toMatchObject({ id: "p1-f1", page: 1, text: "Revenue increased by fifteen percent." });
    expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("preserves original and extracted text without a model call", async () => {
    const { input, output, bytes } = await setup();
    const directory = await runPipeline(input, output);
    expect(await readFile(join(directory, "original.pdf"))).toEqual(Buffer.from(bytes));
    expect(await readdir(directory)).not.toContain("summary.md");
    const second = await runPipeline(input, output);
    expect(second).not.toBe(directory);
  });
  it("runs extraction, injected synthesis, validation and export end to end", async () => {
    const { input, output } = await setup();
    const directory = await runPipeline(input, output, async (source) => ({
      title: "Результаты",
      claims: [
        { text: "Выручка выросла.", evidence: [{ fragmentId: "p1-f1", quote: source.fragments[0]?.text ?? "" }] },
      ],
    }));
    expect(await readFile(join(directory, "summary.md"), "utf8")).toContain("original.pdf#page=1");
    expect(JSON.parse(await readFile(join(directory, "completed.json"), "utf8")).status).toBe("complete");
  });
  it("keeps inputs and records failure when the model fabricates evidence", async () => {
    const { input, output } = await setup();
    await expect(
      runPipeline(input, output, async () => ({
        title: "Итоги",
        claims: [{ text: "Рост", evidence: [{ fragmentId: "p8-f1", quote: "This quotation does not exist." }] }],
      })),
    ).rejects.toThrow("Данные сохранены");
    const [run] = await readdir(output);
    const files = await readdir(join(output, run ?? ""));
    expect(files).toContain("original.pdf");
    expect(files).toContain("failed.json");
    expect(files).not.toContain("summary.md");
  });
  it("rejects non-PDF data and documents without readable text", async () => {
    await expect(extractPdf(new TextEncoder().encode("not a pdf"), "fake.pdf")).rejects.toThrow("не является PDF");
    await expect(extractPdf(pdfFixture(""), "scan.pdf")).rejects.toThrow("нужен OCR");
  });
});
