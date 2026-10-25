#!/usr/bin/env python3
"""Assembles .ico and .icns containers from the PNGs exported by render.js."""
import os
import struct

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def p(*parts):
    return os.path.join(ROOT, *parts)


def ico(out, pngs):
    """Multi-resolution ICO that keeps each hand-tuned size (no resampling)."""
    imgs = [Image.open(f).convert("RGBA") for f in pngs]
    imgs.sort(key=lambda im: im.width, reverse=True)
    imgs[0].save(out, format="ICO", sizes=[im.size for im in imgs], append_images=imgs[1:])


def icns(out, iconset):
    """ICNS with PNG payloads (the format iconutil produces on macOS 10.7+)."""
    types = {
        "icon_16x16.png": b"icp4", "icon_16x16@2x.png": b"ic11",
        "icon_32x32.png": b"icp5", "icon_32x32@2x.png": b"ic12",
        "icon_128x128.png": b"ic07", "icon_128x128@2x.png": b"ic13",
        "icon_256x256.png": b"ic08", "icon_256x256@2x.png": b"ic14",
        "icon_512x512.png": b"ic09", "icon_512x512@2x.png": b"ic10",
    }
    chunks = b""
    for name, code in types.items():
        with open(os.path.join(iconset, name), "rb") as f:
            data = f.read()
        chunks += code + struct.pack(">I", len(data) + 8) + data
    with open(out, "wb") as f:
        f.write(b"icns" + struct.pack(">I", len(chunks) + 8) + chunks)


if __name__ == "__main__":
    win = p("app-icon", "windows", "png")
    ico(p("app-icon", "windows", "Flown.ico"),
        [os.path.join(win, f"flown-{s}.png") for s in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256)])
    icns(p("app-icon", "macos", "Flown.icns"), p("app-icon", "macos", "Flown.iconset"))
    ico(p("web", "favicon.ico"), [p("web", f"favicon-{s}x{s}.png") for s in (16, 32, 48)])

    tray = p("tray", "windows", "png")
    for state in ("idle", "paused", "recording"):
        for tone in ("black", "white"):
            ico(p("tray", "windows", f"flown-tray-{state}-{tone}.ico"),
                [os.path.join(tray, f"flown-tray-{state}-{tone}-{s}.png") for s in (16, 20, 24, 32, 40, 48)])
    ico(p("tray", "windows", "flown-tray-color.ico"),
        [os.path.join(tray, f"flown-tray-color-{s}.png") for s in (16, 20, 24, 32, 40, 48)])
    print("packaged ico/icns")
