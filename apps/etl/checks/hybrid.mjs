import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderGroundedMarkdown } from "../../../packages/core/src/knowledge.ts";
import { chunks } from "../src/chunks.ts";
import { doclingFailure, normalizeDocling, validateOcrOptions } from "../src/docling.ts";
import { extractDocument } from "../src/hybrid.ts";
import { runPipeline } from "../src/pipeline.ts";

function pdf(pages) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", ""];
  const kids = [];
  for (const text of pages) {
    const id = objects.length + 1;
    kids.push(`${id} 0 R`);
    const stream = `BT /F1 12 Tf 50 750 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("");
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

const sentence = "This is a sufficiently long paragraph from a digital PDF document.";
const native = {
  schemaVersion: 1,
  id: "hash",
  sha256: "hash",
  name: "test.pdf",
  mediaType: "application/pdf",
  pageCount: 2,
  fragments: [],
  warnings: [],
};
const payload = {
  schemaVersion: 1,
  version: "test",
  pageCount: 2,
  warnings: [],
  reviewPages: [],
  blocks: [
    { page: 1, text: sentence, kind: "text" },
    {
      page: 2,
      text: "| Name | Value |\n| --- | --- |\n| Mass | 10 kg |",
      kind: "table",
      bounds: { left: 0, top: 100, right: 200, bottom: 0, origin: "BOTTOMLEFT" },
    },
  ],
};

test("chunks preserve all characters and prefer word boundaries", () => {
  const text = "paragraph and equation x = 2\n".repeat(500);
  const parts = chunks(text);
  assert.equal(parts.join(""), text);
  assert.ok(parts.every((p) => p.length <= 6000));
});
test("Docling preserves tables, geometry, provenance and source identity", () => {
  const result = normalizeDocling(payload, native);
  assert.equal(result.sha256, native.sha256);
  assert.equal(result.extraction.status, "complete");
  assert.equal(result.fragments[1].kind, "table");
  assert.equal(result.fragments[1].bounds.origin, "BOTTOMLEFT");
  const markdown = renderGroundedMarkdown(
    {
      title: "Table",
      claims: [
        {
          text: "Mass is 10 kg",
          evidence: [{ fragmentId: result.fragments[1].id, quote: result.fragments[1].text }],
        },
      ],
    },
    result,
  );
  assert.match(markdown, /original.pdf#page=2/);
});
test("missing pages, pictures and formulas produce partial extraction", () => {
  const result = normalizeDocling({ ...payload, blocks: payload.blocks.slice(0, 1), reviewPages: [1] }, native);
  assert.equal(result.extraction.status, "partial");
  assert.equal(result.extraction.pages.filter((p) => p.status === "needs-review").length, 2);
});
test("invalid page count, locations, coordinates and oversized text are rejected", () => {
  for (const bad of [
    { ...payload, pageCount: 3 },
    { ...payload, blocks: [{ ...payload.blocks[0], page: 0 }] },
    { ...payload, blocks: [{ ...payload.blocks[1], bounds: { left: NaN } }] },
    { ...payload, blocks: [{ ...payload.blocks[0], text: "x".repeat(120001) }] },
  ]) {
    assert.throws(() => normalizeDocling(bad, native));
  }
});
test("simple digital PDF stays on the fast path without starting Docling", async () => {
  const result = await extractDocument(pdf([sentence]), "digital.pdf", {}, async () => {
    throw new Error("must not run");
  });
  assert.equal(result.extraction.engine, "pdfjs");
  assert.equal(result.extraction.status, "complete");
});
test("mixed PDF routes to Docling; unavailable OCR keeps explicit partial output", async () => {
  let called = false;
  const bytes = pdf([sentence, ""]);
  const result = await extractDocument(bytes, "mixed.pdf", {}, async (_bytes, source) => {
    called = true;
    return normalizeDocling(payload, source);
  });
  assert.equal(called, true);
  assert.equal(result.extraction.engine, "docling");
  const unavailable = async () => {
    throw new Error("offline");
  };
  const failed = await extractDocument(bytes, "mixed.pdf", {}, unavailable);
  assert.equal(failed.extraction.status, "partial");
  assert.equal(failed.extraction.pages[1].status, "needs-review");
  await assert.rejects(extractDocument(bytes, "mixed.pdf", { extractor: "docling" }, unavailable), /offline/);
});
test("partial extraction blocks model calls; explicit override keeps partial status", async () => {
  const root = await mkdtemp(join(tmpdir(), "archivarious-check-"));
  try {
    const input = join(root, "mixed.pdf");
    const output = join(root, "out");
    await writeFile(input, pdf([sentence, ""]));
    let calls = 0;
    const summarize = async (source) => {
      calls++;
      return {
        title: "Test",
        claims: [{ text: "Test", evidence: [{ fragmentId: source.fragments[0].id, quote: sentence }] }],
      };
    };
    await assert.rejects(runPipeline(input, output, summarize, undefined, { extractor: "pdfjs" }));
    assert.equal(calls, 0);
    const directory = await runPipeline(input, output, summarize, undefined, {
      extractor: "pdfjs",
      allowPartial: true,
    });
    assert.equal(calls, 1);
    assert.equal(JSON.parse(await readFile(join(directory, "completed.json"), "utf8")).status, "partial");
    assert.match(await readFile(join(directory, "summary.md"), "utf8"), /обработан частично/);
    await writeFile(input, "not a PDF");
    await assert.rejects(runPipeline(input, output, undefined, undefined, { extractor: "pdfjs" }));
    const runs = await readdir(output);
    assert.equal(runs.length, 3);
    const failed = await Promise.all(runs.map(async (r) => readdir(join(output, r))));
    assert.equal(failed.filter((files) => files.includes("failed.json")).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("empty scan export explains OCR failure and never calls a model, even with override", async () => {
  const root = await mkdtemp(join(tmpdir(), "archivarious-empty-"));
  try {
    const input = join(root, "scan.pdf");
    const output = join(root, "out");
    await writeFile(input, pdf(["", ""]));
    let calls = 0;
    await assert.rejects(
      runPipeline(
        input,
        output,
        async () => {
          calls++;
        },
        undefined,
        {
          extractor: "pdfjs",
          allowPartial: true,
        },
      ),
      /Текст не извлечён/,
    );
    assert.equal(calls, 0);
    const [run] = await readdir(output);
    const directory = join(output, run);
    assert.match(await readFile(join(directory, "extracted.md"), "utf8"), /Текст не извлечён/);
    assert.match(await readFile(join(directory, "extracted.md"), "utf8"), /--extractor docling/);
    assert.equal(JSON.parse(await readFile(join(directory, "failed.json"), "utf8")).stage, "extraction");
    assert.equal(JSON.parse(await readFile(join(directory, "source.json"), "utf8")).fragments.length, 0);
    assert.ok((await readdir(directory)).includes("original.pdf"));
    assert.ok(!(await readdir(directory)).includes("summary.md"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OCR diagnostics identify setup and timeout failures without exposing stderr", () => {
  const missing = doclingFailure({ code: "ENOENT" }, "secret");
  assert.match(missing.message, /ARCHIVARIOUS_PYTHON/);
  const dependency = doclingFailure({}, "ModuleNotFoundError: No module named 'docling'\nsecret");
  assert.match(dependency.message, /requirements.txt/);
  assert.match(doclingFailure({ killed: true }, "secret").message, /--ocr-timeout/);
  assert.ok(!doclingFailure({}, "secret provider data").message.includes("secret"));
});

test("missing Python is surfaced in auto fallback rather than discarded", async () => {
  const result = await extractDocument(pdf([sentence, ""]), "mixed.pdf", {}, async () => {
    throw doclingFailure({ code: "ENOENT" }, "secret");
  });
  assert.ok(result.warnings.some((w) => w.includes("ARCHIVARIOUS_PYTHON")));
  assert.equal(result.extraction.status, "partial");
});

test("OCR configuration is validated and forwarded to the selected backend", async () => {
  assert.throws(() => validateOcrOptions({ ocrEngine: "unknown" }));
  for (const ocrScale of [0, NaN, 4.1]) assert.throws(() => validateOcrOptions({ ocrScale }));
  for (const timeoutSeconds of [0, NaN, 1.5, 3601]) {
    assert.throws(() => validateOcrOptions({ timeoutSeconds }));
  }
  let received;
  await extractDocument(
    pdf([sentence]),
    "digital.pdf",
    {
      extractor: "docling",
      ocrEngine: "tesseract",
      timeoutSeconds: 900,
      ocrScale: 2,
    },
    async (_bytes, source, options) => {
      received = options;
      return source;
    },
  );
  assert.equal(received.ocrEngine, "tesseract");
  assert.equal(received.timeoutSeconds, 900);
  assert.equal(received.ocrScale, 2);
});

test("Tesseract setup diagnostics distinguish missing binary and language data", () => {
  assert.match(doclingFailure({}, "ARCHIVARIOUS_TESSERACT_MISSING").message, /PATH/);
  assert.match(doclingFailure({}, "ARCHIVARIOUS_TESSERACT_LANGUAGES_MISSING").message, /--list-langs/);
  const result = normalizeDocling({ ...payload, ocrEngine: "tesseract" }, native);
  assert.equal(result.extraction.ocrEngine, "tesseract");
});
