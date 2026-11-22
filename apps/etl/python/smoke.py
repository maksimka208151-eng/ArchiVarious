"""Integration check with digital text and a raster-only second page."""
import json
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas

from convert import convert


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    image = Image.new("RGB", (1500, 900), "white")
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 42)
    ImageDraw.Draw(image).multiline_text(
        (90, 120), "A scanned page contains useful examples.\nThe measured mass is forty two kilograms.",
        font=font, fill="black", spacing=30)
    pdf = root / "mixed.pdf"
    canvas = Canvas(str(pdf))
    canvas.drawString(70, 750, "This digital page contains readable text and a useful explanation.")
    canvas.showPage()
    canvas.drawImage(ImageReader(image), 30, 300, width=540, height=324)
    canvas.save()
    output = root / "result.json"
    convert(pdf, output)
    result = json.loads(output.read_text(encoding="utf-8"))
    assert result["pageCount"] == 2, result
    assert {b["page"] for b in result["blocks"]} == {1, 2}, result
    scanned = " ".join(b["text"] for b in result["blocks"] if b["page"] == 2).lower()
    assert "scanned" in scanned and "kilograms" in scanned, result
    assert all(b["bounds"]["origin"] in ("TOPLEFT", "BOTTOMLEFT") for b in result["blocks"])
    print("Docling digital + scanned PDF integration passed")
