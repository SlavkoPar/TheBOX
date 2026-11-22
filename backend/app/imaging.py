"""Image thumbnails and metadata, made once when a picture is uploaded."""

import warnings
from datetime import datetime
from io import BytesIO

from PIL import Image, ImageOps

THUMB_SIZE = (480, 480)
THUMB_TYPE = "image/webp"
MAX_PIXELS = 60_000_000  # larger images are stored but get no thumbnail

EXIF_IFD = 0x8769
TAG_MAKE, TAG_MODEL, TAG_DATETIME, TAG_DATETIME_ORIGINAL = 271, 272, 306, 36867


def _text(value):
    return str(value).replace("\x00", "").strip() if value else ""


def _camera(exif):
    make, model = _text(exif.get(TAG_MAKE)), _text(exif.get(TAG_MODEL))
    if make and model.lower().startswith(make.lower()):
        make = ""  # many cameras repeat the maker in the model name
    return f"{make} {model}".strip()[:120] or None


def _taken_at(exif):
    raw = _text(exif.get_ifd(EXIF_IFD).get(TAG_DATETIME_ORIGINAL)) or _text(exif.get(TAG_DATETIME))
    try:
        return datetime.strptime(raw[:19], "%Y:%m:%d %H:%M:%S")
    except ValueError:
        return None


def describe_image(content):
    """Metadata and thumbnail of an image.

    Returns a dict with width, height, taken_at, camera and thumb (WebP bytes).
    Returns {} if the content cannot be read as an image; never raises.
    """
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            image = Image.open(BytesIO(content))
            width, height = image.size
            if width * height > MAX_PIXELS:
                return {"width": width, "height": height}

            exif = image.getexif()
            info = {"taken_at": _taken_at(exif), "camera": _camera(exif)}

            image = ImageOps.exif_transpose(image)  # show it the way the camera was held
            info["width"], info["height"] = image.size

            image.thumbnail(THUMB_SIZE)
            if image.mode not in ("RGB", "RGBA"):
                image = image.convert("RGBA" if "transparency" in image.info else "RGB")
            out = BytesIO()
            image.save(out, "WEBP", quality=80)
            info["thumb"] = out.getvalue()
            return info
    except Exception:
        return {}
