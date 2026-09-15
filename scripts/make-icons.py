#!/usr/bin/env python3
"""生成 PWA / 应用图标（几何 "M" 标记，不依赖字体渲染）。

用法: python3 scripts/make-icons.py
输出: public/icons/*.png  public/favicon.svg
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "icons")

C1 = (76, 141, 255)   # #4c8dff
C2 = (124, 92, 255)   # #7c5cff

# "M" 轮廓（0–1 归一化坐标，y 向下）
M_POINTS = [
    (0.08, 0.15), (0.28, 0.15), (0.50, 0.52), (0.72, 0.15),
    (0.92, 0.15), (0.92, 0.85), (0.72, 0.85), (0.72, 0.45),
    (0.50, 0.82), (0.28, 0.45), (0.28, 0.85), (0.08, 0.85),
]


def gradient(size: int) -> Image.Image:
    """先画小图再放大，避免 Python 逐像素循环太慢。"""
    small = Image.new("RGB", (64, 64))
    px = small.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = tuple(round(C1[i] + (C2[i] - C1[i]) * t) for i in range(3))
    return small.resize((size, size), Image.BICUBIC)


def rounded_mask(size: int, radius_ratio: float, ss: int = 4) -> Image.Image:
    n = size * ss
    m = Image.new("L", (n, n), 0)
    ImageDraw.Draw(m).rounded_rectangle(
        [0, 0, n - 1, n - 1], radius=int(n * radius_ratio), fill=255
    )
    return m.resize((size, size), Image.LANCZOS)


def draw_m(img: Image.Image, scale: float = 1.0) -> None:
    """在 img 中央绘制白色 M（scale 控制占位比例）。"""
    w, h = img.size
    box = min(w, h) * scale
    ox = (w - box) / 2
    oy = (h - box) / 2
    pts = [(ox + x * box, oy + y * box) for x, y in M_POINTS]
    # 4x 超采样后缩小，得到平滑边缘
    ss = 4
    layer = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(layer).polygon(
        [(x * ss, y * ss) for x, y in pts], fill=255
    )
    layer = layer.resize((w, h), Image.LANCZOS)
    white = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    img.paste(white, (0, 0), layer)


def make_icon(size: int, radius_ratio: float | None, m_scale: float) -> Image.Image:
    base = gradient(size).convert("RGBA")
    if radius_ratio is not None:
        base.putalpha(rounded_mask(size, radius_ratio))
    else:
        base.putalpha(255)
    draw_m(base, m_scale)
    return base


def make_opaque_icon(size: int, m_scale: float) -> Image.Image:
    """全出血且不透明：保存为 RGB（无 alpha 通道），iOS / maskable 都要求如此。"""
    return make_icon(size, None, m_scale).convert("RGB")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)

    # 常规图标：圆角 + M 占 52%
    for s in (192, 512):
        make_icon(s, 0.22, 0.52).save(os.path.join(OUT, f"icon-{s}.png"))
        print(f"icons/icon-{s}.png")

    # maskable：全出血、无圆角，M 缩到 36% 以落在安全区内
    make_opaque_icon(512, 0.36).save(os.path.join(OUT, "icon-maskable-512.png"))
    print("icons/icon-maskable-512.png")

    # iOS 桌面图标：不透明、全出血（系统自己会切圆角）
    make_opaque_icon(180, 0.52).save(os.path.join(OUT, "apple-touch-icon.png"))
    print("icons/apple-touch-icon.png")

    make_icon(64, 0.22, 0.54).save(os.path.join(OUT, "favicon-64.png"))
    print("icons/favicon-64.png")

    # SVG favicon（与 PNG 同一套 M 轮廓）
    pts = " ".join(f"{x:.2f},{y:.2f}" for x, y in M_POINTS)
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4c8dff"/>
      <stop offset="1" stop-color="#7c5cff"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#g)"/>
  <g transform="translate(9.6 9.6) scale(33.28)">
    <polygon points="{pts}" fill="#ffffff"/>
  </g>
</svg>
"""
    with open(os.path.join(ROOT, "public", "favicon.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
    print("favicon.svg")


if __name__ == "__main__":
    main()
