"""Tiny deterministic PDF builder for document-import tests (no binary fixtures in the repository).

A page is a dict with optional "text" (list of lines, Helvetica, WinAnsi so French accents work)
and optional "image" ((width, height, 8-bit gray bytes), drawn over the whole page). An empty dict
is a blank page.
"""

import zlib

PAGE_W, PAGE_H = 612, 792


def _escape(line: str) -> bytes:
    raw = line.encode("cp1252")
    return raw.replace(b"\\", b"\\\\").replace(b"(", b"\\(").replace(b")", b"\\)")


def build_pdf(pages: list[dict]) -> bytes:
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)

    catalog = add(b"")  # filled in once the page tree exists
    pages_id = add(b"")
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    kids = []
    for spec in pages:
        ops, resources = [], [b"/Font << /F1 %d 0 R >>" % font]
        if "image" in spec:
            width, height, gray = spec["image"]
            data = zlib.compress(gray)
            image = add(b"<< /Type /XObject /Subtype /Image /Width %d /Height %d /ColorSpace /DeviceGray "
                        b"/BitsPerComponent 8 /Filter /FlateDecode /Length %d >>\nstream\n" % (width, height, len(data))
                        + data + b"\nendstream")
            resources.append(b"/XObject << /Im1 %d 0 R >>" % image)
            ops.append(b"q %d 0 0 %d 0 0 cm /Im1 Do Q" % (PAGE_W, PAGE_H))
        if spec.get("text"):
            ops.append(b"BT /F1 12 Tf 16 TL 72 720 Td")
            ops.extend(b"(" + _escape(line) + b") Tj T*" for line in spec["text"])
            ops.append(b"ET")
        stream = b"\n".join(ops)
        content = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        kids.append(add(b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %d %d] /Resources << %s >> /Contents %d 0 R >>"
                        % (pages_id, PAGE_W, PAGE_H, b" ".join(resources), content)))
    objects[catalog - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id
    objects[pages_id - 1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (
        b" ".join(b"%d 0 R" % k for k in kids), len(kids))

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, catalog, xref)
    return bytes(out)


def stripes(width: int = 64, height: int = 64) -> tuple[int, int, bytes]:
    """A synthetic image page with no text layer."""
    return width, height, bytes((0 if (y // 4) % 2 else 255) for y in range(height) for _ in range(width))


def text_image(lines: list[str], size: int = 44, font_path=None) -> tuple[int, int, bytes]:
    """Render text into a grayscale image with Pillow (OCR integration tests only)."""
    from PIL import Image, ImageDraw, ImageFont

    width, height = 1700, 2200
    image = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(str(font_path), size) if font_path else ImageFont.load_default(size=size)
    for i, line in enumerate(lines):
        draw.text((120, 160 + i * int(size * 1.8)), line, fill=0, font=font)
    return width, height, image.tobytes()
