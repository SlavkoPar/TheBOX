"""Read-only previews of Office files, as plain data the frontend renders.

Only text is extracted (no macros, images or formatting), so a preview cannot
carry active content. Supported: Word (.docx), Excel (.xlsx), PowerPoint (.pptx).
"""

import zipfile
from io import BytesIO

MAX_UNPACKED = 200 * 1024 * 1024  # refuse zip bombs
MAX_BLOCKS = 2000
MAX_ROWS, MAX_COLS, MAX_SHEETS = 200, 50, 10
MAX_SLIDES = 200

DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation"

KIND_BY_EXTENSION = {".docx": "document", ".xlsx": "sheets", ".pptx": "slides"}


class PreviewError(Exception):
    pass


def preview_kind(name):
    for extension, kind in KIND_BY_EXTENSION.items():
        if name.lower().endswith(extension):
            return kind
    return None


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _document(content):
    import docx

    document = docx.Document(BytesIO(content))
    blocks = []
    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue
        style = (paragraph.style.name or "").lower() if paragraph.style is not None else ""
        if style.startswith("heading") or style == "title":
            level = 1 if style == "title" else int(style[-1]) if style[-1].isdigit() else 2
            blocks.append({"type": "heading", "level": min(max(level, 1), 3), "text": text})
        elif style.startswith("list"):
            blocks.append({"type": "list-item", "text": text})
        else:
            blocks.append({"type": "paragraph", "text": text})
        if len(blocks) >= MAX_BLOCKS:
            return {"kind": "document", "blocks": blocks, "truncated": True}
    for table in document.tables:
        rows = [[cell.text.strip() for cell in row.cells[:MAX_COLS]] for row in table.rows[:MAX_ROWS]]
        blocks.append({"type": "table", "rows": rows})
    return {"kind": "document", "blocks": blocks, "truncated": False}


def _sheets(content):
    import openpyxl

    workbook = openpyxl.load_workbook(BytesIO(content), read_only=True, data_only=True)
    sheets, truncated = [], len(workbook.worksheets) > MAX_SHEETS
    try:
        for sheet in workbook.worksheets[:MAX_SHEETS]:
            rows = []
            for index, row in enumerate(sheet.iter_rows(values_only=True)):
                if index >= MAX_ROWS:
                    truncated = True
                    break
                if len(row) > MAX_COLS:
                    truncated = True
                rows.append([_cell(value) for value in row[:MAX_COLS]])
            while rows and not any(rows[-1]):
                rows.pop()  # trailing empty rows
            width = max((max((i + 1 for i, v in enumerate(r) if v), default=0) for r in rows), default=0)
            sheets.append({"name": sheet.title, "rows": [r[:width] for r in rows]})
    finally:
        workbook.close()
    return {"kind": "sheets", "sheets": sheets, "truncated": truncated}


def _slides(content):
    from pptx import Presentation

    presentation = Presentation(BytesIO(content))
    slides = []
    for index, slide in enumerate(presentation.slides):
        if index >= MAX_SLIDES:
            return {"kind": "slides", "slides": slides, "truncated": True}
        title_shape = slide.shapes.title
        title = title_shape.text_frame.text.strip() if title_shape is not None else ""
        lines = []
        for shape in slide.shapes:
            is_title = title_shape is not None and shape.shape_id == title_shape.shape_id
            if not shape.has_text_frame or is_title:
                continue
            lines += [p.text.strip() for p in shape.text_frame.paragraphs if p.text.strip()]
        slides.append({"title": title, "lines": lines})
    return {"kind": "slides", "slides": slides, "truncated": False}


def build_preview(name, content):
    """Preview data for an Office file. Raises PreviewError if it cannot be made."""
    kind = preview_kind(name)
    if kind is None:
        raise PreviewError("This type of file cannot be previewed.")
    try:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > MAX_UNPACKED:
                raise PreviewError("This file is too large to preview.")
        return {"document": _document, "sheets": _sheets, "slides": _slides}[kind](content)
    except PreviewError:
        raise
    except Exception:
        raise PreviewError("This file could not be read. It may be damaged.") from None
