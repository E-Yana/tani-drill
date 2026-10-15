"""たんいドリルのアイコン（192 / 512）を作る。英数字と図形だけで描く（日本語フォント不要）。"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ICON_SIZES: tuple[int, ...] = (192, 512)
BG_COLOR = (46, 125, 79)  # 緑の地
FG_COLOR = (255, 255, 255)
ICON_DIR = Path(__file__).resolve().parent.parent / "icons"
FONT_CANDIDATES: tuple[str, ...] = (
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
)
TEXT = "cm"
RULER_TOP_RATIO = 0.62  # ものさしの上端（全体に対する比）
RULER_BOTTOM_RATIO = 0.82
RULER_SIDE_RATIO = 0.12
TICK_COUNT = 10
TICK_LONG_RATIO = 0.10  # 長い目盛りの長さ
TICK_SHORT_RATIO = 0.06
TICK_WIDTH_RATIO = 0.012
TEXT_HEIGHT_RATIO = 0.42  # 文字の高さの目安
CORNER_RATIO = 0.03
TEXT_TOP_RATIO = 0.12  # 文字の上端位置


def load_font(px: int) -> ImageFont.ImageFont | ImageFont.FreeTypeFont:
    """使えるフォントを探して返す。無ければ既定フォント。"""
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, px)
    return ImageFont.load_default(px)


def draw_text(draw: ImageDraw.ImageDraw, size: int) -> None:
    """上半分に白い「cm」を中央寄せで描く。"""
    font = load_font(int(size * TEXT_HEIGHT_RATIO))
    box = draw.textbbox((0, 0), TEXT, font=font)
    width = box[2] - box[0]
    x = (size - width) / 2 - box[0]
    y = size * TEXT_TOP_RATIO - box[1]
    draw.text((x, y), TEXT, font=font, fill=FG_COLOR)


def draw_ruler(draw: ImageDraw.ImageDraw, size: int) -> None:
    """下側に白いものさしと目盛りを描く。"""
    left = size * RULER_SIDE_RATIO
    right = size - left
    top = size * RULER_TOP_RATIO
    bottom = size * RULER_BOTTOM_RATIO
    draw.rounded_rectangle(
        (left, top, right, bottom), radius=size * CORNER_RATIO, fill=FG_COLOR
    )
    tick_width = max(1, int(size * TICK_WIDTH_RATIO))
    for i in range(TICK_COUNT + 1):
        x = left + (right - left) * i / TICK_COUNT
        is_long = i % 5 == 0
        length = size * (TICK_LONG_RATIO if is_long else TICK_SHORT_RATIO)
        draw.line((x, top, x, top + length), fill=BG_COLOR, width=tick_width)


def make_icon(size: int) -> Image.Image:
    """1枚のアイコン画像を作る。"""
    img = Image.new("RGB", (size, size), BG_COLOR)
    draw = ImageDraw.Draw(img)
    draw_text(draw, size)
    draw_ruler(draw, size)
    return img


def main() -> None:
    """各サイズの PNG を icons/ に書き出す。"""
    ICON_DIR.mkdir(exist_ok=True)
    for size in ICON_SIZES:
        make_icon(size).save(ICON_DIR / f"icon-{size}.png")


if __name__ == "__main__":
    main()
