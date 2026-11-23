"""Local-only Docling bridge. Process output is never treated as evidence."""
import argparse
import json
import shutil
import subprocess
from importlib.metadata import version
from pathlib import Path


def convert(input_path, output_path, ocr_engine="easyocr", force_ocr=False, ocr_scale=3):
    from docling.datamodel.base_models import InputFormat, ConversionStatus
    from docling.datamodel.pipeline_options import EasyOcrOptions, PdfPipelineOptions, TesseractCliOcrOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    options = PdfPipelineOptions()
    options.do_ocr = True
    options.do_table_structure = True
    options.enable_remote_services = False
    options.do_formula_enrichment = False
    if ocr_engine == "tesseract":
        if not shutil.which("tesseract"):
            raise RuntimeError("ARCHIVARIOUS_TESSERACT_MISSING")
        languages = subprocess.run(
            ["tesseract", "--list-langs"], capture_output=True, text=True, check=True
        ).stdout.splitlines()
        if not {"eng", "rus"}.issubset({line.strip() for line in languages}):
            raise RuntimeError("ARCHIVARIOUS_TESSERACT_LANGUAGES_MISSING")
        options.ocr_options = TesseractCliOcrOptions(lang=["eng", "rus"], force_full_page_ocr=force_ocr, scale=ocr_scale)
    elif ocr_engine == "easyocr":
        options.ocr_options = EasyOcrOptions(lang=["ru", "en"], use_gpu=False, force_full_page_ocr=force_ocr, scale=ocr_scale)
    else:
        raise ValueError("Unsupported OCR engine")
    converter = DocumentConverter(format_options={
        InputFormat.PDF: PdfFormatOption(pipeline_options=options)
    })
    result = converter.convert(Path(input_path), max_num_pages=150, max_file_size=30 * 1024 * 1024)
    if result.status != ConversionStatus.SUCCESS:
        raise RuntimeError("Docling did not fully convert the PDF")
    doc = result.document
    blocks = []
    review_pages = set()
    for item, _level in doc.iterate_items():
        label = item.label.value
        prov = item.prov
        if not prov:
            continue
        if label in ("picture", "formula"):
            review_pages.update(p.page_no for p in prov)
        if label == "picture":
            continue
        text = item.export_to_markdown(doc=doc) if label == "table" else getattr(item, "text", "")
        if not text:
            continue
        if len({p.page_no for p in prov}) > 1:
            review_pages.update(p.page_no for p in prov)
            continue
        p = prov[0]
        b = p.bbox
        blocks.append({"page": p.page_no, "text": text, "kind": label,
                       "bounds": {"left": b.l, "top": b.t, "right": b.r,
                                  "bottom": b.b, "origin": b.coord_origin.value}})
    payload = {"schemaVersion": 1, "version": version("docling"),
               "ocrEngine": ocr_engine,
               "pageCount": len(doc.pages), "blocks": blocks,
               "reviewPages": sorted(review_pages),
               "warnings": ["OCR и структура таблиц требуют проверки; формулы и изображения не интерпретированы."]}
    Path(output_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--ocr-engine", choices=["easyocr", "tesseract"], default="easyocr")
    parser.add_argument("--force-ocr", action="store_true")
    parser.add_argument("--ocr-scale", type=float, default=3)
    args = parser.parse_args()
    if not 1 <= args.ocr_scale <= 4:
        parser.error("--ocr-scale must be between 1 and 4")
    convert(args.input, args.output, args.ocr_engine, args.force_ocr, args.ocr_scale)
