#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML file.

The multi-file version already works as-is on any static host (GitHub Pages,
Netlify, Vercel — see README). This build exists for the other distribution
case: handing someone a single file they can double-click, email, or drop on
a host without worrying about relative paths. Loading app.js from a file://
page is fine today, but inlining also keeps it working if the code ever
moves to ES modules, which file:// blocks under CORS.

Usage:  python3 build.py   ->  dist/index.html
"""

import html
import pathlib
import re

ROOT = pathlib.Path(__file__).parent
DIST = ROOT / "dist"


def read(name):
    return (ROOT / name).read_text(encoding="utf-8")


def main():
    page = read("index.html")

    # Inline the stylesheet. The replacement text goes through a lambda
    # because re.sub interprets backslashes and \g in a plain string
    # replacement, and CSS/JS content can legitimately contain both.
    css = read("style.css")
    page = re.sub(
        r'<link rel="stylesheet" href="style\.css"\s*/?>',
        lambda _: f"<style>\n{css}\n</style>",
        page,
    )

    # Inline the local scripts, in their original order. The MediaPipe
    # <script src="https://..."> tag is deliberately left alone: it, and the
    # other ML models, are fetched from a CDN at runtime by design, so the
    # "single file" is self-contained for everything except the optional
    # ML cutout modes, which need the network either way.
    for name in ("palette.js", "app.js"):
        js = read(name)
        page = re.sub(
            rf'<script src="{re.escape(name)}"></script>',
            lambda _: f"<script>\n{js}\n</script>",
            page,
        )

    for leftover in re.findall(r'<script src="(?!https?:)([^"]+)"', page):
        raise SystemExit(f"build.py: local script not inlined: {leftover}")
    if 'href="style.css"' in page:
        raise SystemExit("build.py: stylesheet not inlined")

    DIST.mkdir(exist_ok=True)
    out = DIST / "index.html"
    out.write_text(page, encoding="utf-8")
    print(f"wrote {out} ({len(page.encode('utf-8')) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
