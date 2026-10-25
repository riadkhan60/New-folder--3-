#!/usr/bin/env python3
"""Flown brand kit generator.

Writes every SVG in the kit from the master vector geometry below, plus
`scripts/raster-manifest.json`, which `render.js` uses to export PNG/PDF.
Run `node scripts/build-all.js` (or see README) to rebuild everything.
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------------------
# Master geometry. Traced from the 1254px reference artwork and redrawn as
# clean beziers; coordinates are in that reference's pixel space.
# ---------------------------------------------------------------------------
BLADE_TOP = ("M273 607C272.5 575 300 527.5 345 519L486 499.5C492 498.7 496.5 502 495.5 507"
             "C490.5 535 469 564.5 432 570.5L320 585C300 588 283 597 273 607Z")
BLADE_LOW = ("M424 589.5L330 602C290.5 608 266.5 645 266.5 681C266.5 711 286 732.5 305.5 738.5"
             "C313 741 318.5 736 319.5 729L329.5 673C331.5 661 340 658.5 352 657L378 654"
             "C410 650 428 620 430 597C431 591 428 589 424 589.5Z")
# Region of the lower blade that sits "under the fold" (clipped to BLADE_LOW).
FOLD = "M347 597C335 614 329.5 640 331 664L470 664L470 585Z"
WORD = {
    "F": "M539 562A10 10 0 0 1 549 552H633V575H564V603H621V627H564V677H539Z",
    "l": "M640 552H664.5V677H640Z",
    "o": ("M724.5 580.5A48.5 48.5 0 1 1 724.5 677.5A48.5 48.5 0 1 1 724.5 580.5Z"
          "M724.5 604.8A24.2 24.2 0 1 0 724.5 653.2A24.2 24.2 0 1 0 724.5 604.8Z"),
    "w": ("M770.63 581.5L795.2 581.5L814.2 639.95L830.9 589.36A11.16 11.16 0 0 1 852.1 589.36"
          "L868.8 639.95L887.8 581.5L912.37 581.5L884.02 668.69A14.07 14.07 0 0 1 857.28 668.75"
          "L841.5 620.95L825.72 668.75A14.07 14.07 0 0 1 798.98 668.69Z"),
    "n": "M914 677V626A45 45 0 0 1 1004 626V677H979.5V626A20.75 20.75 0 0 0 938 626V677Z",
}
WORD_D = "".join(WORD[k] for k in "Flown")

MARK_BOX = (266.5, 499.38, 495.64, 739.15)   # x0, y0, x1, y1
WORD_BOX = (539.0, 552.0, 1004.0, 677.0)

# ---------------------------------------------------------------------------
# Palette
# ---------------------------------------------------------------------------
INK = "#0D0F1C"
INK_2 = "#161829"
WHITE = "#FFFFFF"
RECORD = "#FF4757"
TOP_STOPS = [(0, "#5683FF"), (0.14, "#5A7AFD"), (0.49, "#7568FD"), (0.88, "#8641FE"), (1, "#8B3AFF")]
LOW_STOPS = [(0, "#3FCBFF"), (0.3, "#4D9BFF"), (0.5, "#5A78FD"), (0.68, "#6252FC"),
             (0.88, "#7742FD"), (1, "#7D3BFF")]
# Gradient axes in reference space
TOP_AXIS = ((275, 600), (495, 500))
LOW_AXIS = ((295, 738), (430, 590))
SHEEN = [(0, WHITE, ".30"), (1, WHITE, "0")]

# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------
_TOK = re.compile(r"[MLHVCSQTAZmlhvcsqtaz]|-?\d*\.?\d+(?:e-?\d+)?")
_ARITY = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s


def tf(d, s=1.0, tx=0.0, ty=0.0):
    """Scale+translate an absolute-command path."""
    toks = _TOK.findall(d)
    out, i, cmd = [], 0, None
    while i < len(toks):
        t = toks[i]
        if t.isalpha():
            cmd = t
            assert cmd.isupper(), "only absolute commands supported"
            out.append(cmd)
            i += 1
            if cmd == "Z":
                continue
        n = _ARITY[cmd]
        a = [float(x) for x in toks[i:i + n]]
        i += n
        if cmd in "MLCSQT":
            vals = [a[k] * s + (tx if k % 2 == 0 else ty) for k in range(n)]
        elif cmd == "H":
            vals = [a[0] * s + tx]
        elif cmd == "V":
            vals = [a[0] * s + ty]
        else:  # A
            vals = [a[0] * s, a[1] * s, a[2], a[3], a[4], a[5] * s + tx, a[6] * s + ty]
        out.append(" ".join(fmt(v) for v in vals))
    return re.sub(r" ?([A-Z]) ?", r"\1", " ".join(out)).replace(" -", "-")


def pt(p, s, tx, ty):
    return p[0] * s + tx, p[1] * s + ty


def lin_grad(gid, axis, stops, s, tx, ty, extra=""):
    (x1, y1), (x2, y2) = pt(axis[0], s, tx, ty), pt(axis[1], s, tx, ty)
    st = "".join(f'<stop offset="{o}" stop-color="{c}"' + (f' stop-opacity="{a[0]}"' if a else "") + "/>"
                 for o, c, *a in stops)
    return (f'<linearGradient id="{gid}" x1="{fmt(x1)}" y1="{fmt(y1)}" x2="{fmt(x2)}" y2="{fmt(y2)}" '
            f'gradientUnits="userSpaceOnUse"{extra}>{st}</linearGradient>')


def mark(uid, s, tx, ty, style="full", color=None, low_shift=(0, 0)):
    """Return (defs, body) drawing the mark mapped by x*s+tx, y*s+ty.

    style: full (gradients + fold + sheen), flat (gradients only), mono (solid colour).
    low_shift nudges the lower blade (reference units) - used to open up the
    gap between the blades for tiny renderings.
    """
    top = tf(BLADE_TOP, s, tx, ty)
    lx, ly = low_shift
    low = tf(BLADE_LOW, s, tx + lx * s, ty + ly * s)
    if style == "mono":
        return "", f'<path fill="{color}" d="{top}"/><path fill="{color}" d="{low}"/>'
    defs = [lin_grad(f"{uid}-a", TOP_AXIS, TOP_STOPS, s, tx, ty),
            lin_grad(f"{uid}-b", LOW_AXIS, LOW_STOPS, s, tx + lx * s, ty + ly * s)]
    body = [f'<path fill="url(#{uid}-a)" d="{top}"/>', f'<path fill="url(#{uid}-b)" d="{low}"/>']
    if style == "full":
        fold = tf(FOLD, s, tx + lx * s, ty + ly * s)
        defs += [
            f'<clipPath id="{uid}-c"><path d="{low}"/></clipPath>',
            # soft shadow just inside the fold line
            lin_grad(f"{uid}-d", ((331, 0), (392, 0)), [(0, "#3A2BD9", ".42"), (1, "#3A2BD9", "0")],
                     s, tx + lx * s, ty + ly * s),
            # sheen along each blade's leading (top) edge
            lin_grad(f"{uid}-e", ((400, 506.5), (401.7, 519.5)), SHEEN, s, tx, ty),
            lin_grad(f"{uid}-f", ((380, 595), (381.5, 606)), SHEEN, s, tx + lx * s, ty + ly * s),
        ]
        body += [f'<path clip-path="url(#{uid}-c)" fill="url(#{uid}-d)" d="{fold}"/>',
                 f'<path fill="url(#{uid}-e)" d="{top}"/>',
                 f'<path fill="url(#{uid}-f)" d="{low}"/>']
    return "".join(defs), "".join(body)


def word(s, tx, ty, color):
    return f'<path fill="{color}" d="{tf(WORD_D, s, tx, ty)}"/>'


def svg(w, h, defs, body, title=None):
    t = f"<title>{title}</title>" if title else ""
    d = f"<defs>{defs}</defs>" if defs else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(w)}" height="{fmt(h)}" '
            f'viewBox="0 0 {fmt(w)} {fmt(h)}" fill="none">{t}{d}{body}</svg>\n')


# ---------------------------------------------------------------------------
# Output bookkeeping
# ---------------------------------------------------------------------------
RASTER = []   # {"svg", "png", "w", "h"}
PDF = []      # {"svg", "pdf"}


def write(rel, text):
    path = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)
    return rel


def png(svg_rel, png_rel, w, h=None):
    RASTER.append({"svg": svg_rel, "png": png_rel, "w": w, "h": h or w})


# ---------------------------------------------------------------------------
# 1. Logos
# ---------------------------------------------------------------------------
def logos():
    mx0, my0, mx1, my1 = MARK_BOX
    mw, mh = mx1 - mx0, my1 - my0

    # Mark in a 240 square, centred.
    S = 240
    s = 1.0
    tx = (S - mw) / 2 - mx0
    ty = (S - mh) / 2 - my0
    variants = {
        "flown-mark": ("full", None),
        "flown-mark-flat": ("flat", None),
        "flown-mark-white": ("mono", WHITE),
        "flown-mark-black": ("mono", "#000000"),
        "flown-mark-ink": ("mono", INK),
    }
    for name, (style, color) in variants.items():
        defs, body = mark("fm", s, tx, ty, style, color)
        rel = write(f"logo/svg/{name}.svg", svg(S, S, defs, body, "Flown"))
        for size in (256, 512, 1024, 2048):
            png(rel, f"logo/png/{name}-{size}.png", size)
        PDF.append({"svg": rel, "pdf": f"logo/pdf/{name}.pdf"})

    # Horizontal lockup: the reference spacing, tight bounding box.
    x0, y0 = mx0, my0
    W, H = WORD_BOX[2] - x0, my1 - my0
    lock = {
        "on-dark": ("full", None, WHITE),
        "on-light": ("full", None, INK),
        "white": ("mono", WHITE, WHITE),
        "black": ("mono", "#000000", "#000000"),
    }
    for name, (style, mcol, wcol) in lock.items():
        defs, body = mark("fh", 1, -x0, -y0, style, mcol)
        rel = write(f"logo/svg/flown-logo-horizontal-{name}.svg",
                    svg(W, H, defs, body + word(1, -x0, -y0, wcol), "Flown"))
        for w in (600, 1200, 2400):
            png(rel, f"logo/png/flown-logo-horizontal-{name}-{w}w.png", w, round(w * H / W))
        PDF.append({"svg": rel, "pdf": f"logo/pdf/flown-logo-horizontal-{name}.pdf"})

    # Stacked lockup: mark centred above the wordmark.
    ww, wh = WORD_BOX[2] - WORD_BOX[0], WORD_BOX[3] - WORD_BOX[1]
    gap = 64
    SW, SH = ww, mh + gap + wh
    mtx, mty = (SW - mw) / 2 - mx0, -my0
    wtx, wty = -WORD_BOX[0], mh + gap - WORD_BOX[1]
    for name, (style, mcol, wcol) in lock.items():
        defs, body = mark("fs", 1, mtx, mty, style, mcol)
        rel = write(f"logo/svg/flown-logo-stacked-{name}.svg",
                    svg(SW, SH, defs, body + word(1, wtx, wty, wcol), "Flown"))
        for w in (480, 960, 1920):
            png(rel, f"logo/png/flown-logo-stacked-{name}-{w}w.png", w, round(w * SH / SW))
        PDF.append({"svg": rel, "pdf": f"logo/pdf/flown-logo-stacked-{name}.pdf"})

    # Wordmark alone.
    for name, col in (("white", WHITE), ("ink", INK), ("black", "#000000")):
        rel = write(f"logo/svg/flown-wordmark-{name}.svg",
                    svg(ww, wh, "", word(1, -WORD_BOX[0], -WORD_BOX[1], col), "Flown"))
        for w in (465, 930, 1860):
            png(rel, f"logo/png/flown-wordmark-{name}-{w}w.png", w, round(w * wh / ww))
        PDF.append({"svg": rel, "pdf": f"logo/pdf/flown-wordmark-{name}.pdf"})


# ---------------------------------------------------------------------------
# 2. App icons
# ---------------------------------------------------------------------------
def tile_layers(uid, x, y, size, radius, glow=True, border=True, shadow=False):
    """Dark gradient tile with optional glow, edge light and drop shadow."""
    cx = x + size / 2
    defs = [
        f'<linearGradient id="{uid}-bg" x1="{fmt(cx)}" y1="{fmt(y)}" x2="{fmt(cx)}" y2="{fmt(y + size)}" '
        f'gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#1E2140"/>'
        f'<stop offset="1" stop-color="#0B0C18"/></linearGradient>',
    ]
    body = []
    if shadow:
        defs.append(f'<filter id="{uid}-sh" x="-20%" y="-20%" width="140%" height="140%">'
                    f'<feGaussianBlur stdDeviation="{fmt(size * 0.012)}"/></filter>')
        body.append(f'<rect x="{fmt(x)}" y="{fmt(y + size * 0.012)}" width="{fmt(size)}" height="{fmt(size)}" '
                    f'rx="{fmt(radius)}" fill="#000" fill-opacity=".38" filter="url(#{uid}-sh)"/>')
    body.append(f'<rect x="{fmt(x)}" y="{fmt(y)}" width="{fmt(size)}" height="{fmt(size)}" rx="{fmt(radius)}" '
                f'fill="url(#{uid}-bg)"/>')
    if glow:
        defs += [
            f'<radialGradient id="{uid}-g1" cx="{fmt(x + size * 0.6)}" cy="{fmt(y + size * 0.38)}" '
            f'r="{fmt(size * 0.55)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#7B4DFF" '
            f'stop-opacity=".42"/><stop offset="1" stop-color="#7B4DFF" stop-opacity="0"/></radialGradient>',
            f'<radialGradient id="{uid}-g2" cx="{fmt(x + size * 0.32)}" cy="{fmt(y + size * 0.78)}" '
            f'r="{fmt(size * 0.45)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#3FCBFF" '
            f'stop-opacity=".28"/><stop offset="1" stop-color="#3FCBFF" stop-opacity="0"/></radialGradient>',
        ]
        body += [f'<rect x="{fmt(x)}" y="{fmt(y)}" width="{fmt(size)}" height="{fmt(size)}" rx="{fmt(radius)}" '
                 f'fill="url(#{uid}-g{k})"/>' for k in (1, 2)]
    if border:
        sw = max(size / 512, 1)
        defs.append(f'<linearGradient id="{uid}-bd" x1="{fmt(cx)}" y1="{fmt(y)}" x2="{fmt(cx)}" y2="{fmt(y + size)}" '
                    f'gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity=".22"/>'
                    f'<stop offset=".5" stop-color="#fff" stop-opacity=".05"/>'
                    f'<stop offset="1" stop-color="#fff" stop-opacity=".10"/></linearGradient>')
        body.append(f'<rect x="{fmt(x + sw / 2)}" y="{fmt(y + sw / 2)}" width="{fmt(size - sw)}" '
                    f'height="{fmt(size - sw)}" rx="{fmt(radius - sw / 2)}" stroke="url(#{uid}-bd)" '
                    f'stroke-width="{fmt(sw)}"/>')
    return "".join(defs), "".join(body)


def placed_mark(uid, box_x, box_y, box_size, fill_ratio, style="full", color=None,
                low_shift=(0, 0), nudge=(0.0, 0.0)):
    """Mark scaled so its height is fill_ratio*box_size, centred in the box."""
    mx0, my0, mx1, my1 = MARK_BOX
    my1 += low_shift[1]
    mx0 += min(0, low_shift[0])
    mw, mh = mx1 - mx0, my1 - my0
    s = box_size * fill_ratio / mh
    tx = box_x + (box_size - mw * s) / 2 - mx0 * s + nudge[0] * box_size
    ty = box_y + (box_size - mh * s) / 2 - my0 * s + nudge[1] * box_size
    return mark(uid, s, tx, ty, style, color, low_shift)


SMALL_SHIFT = (-1.5, 7)   # opens the blade gap so it survives at 16-32px


def app_icons():
    # macOS: 1024 canvas, 824 tile, Big Sur grid, baked-in shadow.
    d1, b1 = tile_layers("mi", 100, 100, 824, 185.4, shadow=True)
    d2, b2 = placed_mark("mm", 100, 100, 824, 0.56, nudge=(0.004, 0))
    mac = write("app-icon/svg/flown-app-icon-macos.svg", svg(1024, 1024, d1 + d2, b1 + b2, "Flown"))

    # Full-bleed rounded tile (Windows, Linux, generic).
    d1, b1 = tile_layers("ai", 0, 0, 1024, 230)
    d2, b2 = placed_mark("am", 0, 0, 1024, 0.6, nudge=(0.004, 0))
    full = write("app-icon/svg/flown-app-icon.svg", svg(1024, 1024, d1 + d2, b1 + b2, "Flown"))

    # Small-size master (16-48px): flat mark, bigger, wider blade gap, no glow.
    d1, b1 = tile_layers("si", 0, 0, 256, 56, glow=False, border=False)
    d2, b2 = placed_mark("sm", 0, 0, 256, 0.7, "flat", low_shift=SMALL_SHIFT)
    small = write("app-icon/svg/flown-app-icon-small.svg", svg(256, 256, d1 + d2, b1 + b2, "Flown"))

    # macOS small sizes keep the macOS margin but use the simplified art.
    d1, b1 = tile_layers("ms", 100, 100, 824, 185.4, glow=False, border=False)
    d2, b2 = placed_mark("mt", 100, 100, 824, 0.66, "flat", low_shift=SMALL_SHIFT)
    mac_small = write("app-icon/svg/flown-app-icon-macos-small.svg", svg(1024, 1024, d1 + d2, b1 + b2, "Flown"))

    # Square, opaque (iOS / apple-touch / store listings - the OS applies its own mask).
    d1, b1 = tile_layers("qi", 0, 0, 1024, 0, border=False)
    d2, b2 = placed_mark("qm", 0, 0, 1024, 0.56, nudge=(0.004, 0))
    square = write("app-icon/svg/flown-app-icon-square.svg", svg(1024, 1024, d1 + d2, b1 + b2, "Flown"))

    # Maskable (Android / PWA): mark inside the 80% safe circle.
    d2, b2 = placed_mark("km", 0, 0, 1024, 0.44, nudge=(0.004, 0))
    maskable = write("app-icon/svg/flown-app-icon-maskable.svg", svg(1024, 1024, d1.replace("qi-", "ki-") + d2,
                                                                    b1.replace("qi-", "ki-") + b2, "Flown"))

    # --- macOS .iconset (assembled into .icns by package.py)
    for base, scale in ((16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)):
        px = base * scale
        name = f"icon_{base}x{base}{'@2x' if scale == 2 else ''}.png"
        png(mac_small if px <= 32 else mac, f"app-icon/macos/Flown.iconset/{name}", px)
    for px in (16, 32, 64, 128, 256, 512, 1024):
        png(mac_small if px <= 32 else mac, f"app-icon/macos/png/flown-macos-{px}.png", px)

    # --- Windows (.ico assembled by package.py)
    for px in (16, 20, 24, 32, 40, 48, 64, 96, 128, 256):
        png(small if px <= 48 else full, f"app-icon/windows/png/flown-{px}.png", px)
    for name, px in (("Square44x44Logo", 44), ("Square71x71Logo", 71), ("Square150x150Logo", 150),
                     ("Square284x284Logo", 284), ("Square310x310Logo", 310), ("StoreLogo", 50)):
        png(small if px <= 48 else full, f"app-icon/windows/tiles/{name}.png", px)

    # --- Linux hicolor theme
    for px in (16, 22, 24, 32, 48, 64, 128, 256, 512):
        png(small if px <= 48 else full, f"app-icon/linux/hicolor/{px}x{px}/apps/flown.png", px)
    write("app-icon/linux/hicolor/scalable/apps/flown.svg", open(os.path.join(ROOT, full)).read())

    # --- Generic PNG exports
    for px in (64, 128, 256, 512, 1024):
        png(full, f"app-icon/png/flown-app-icon-{px}.png", px)
        png(square, f"app-icon/png/flown-app-icon-square-{px}.png", px)
    png(maskable, "app-icon/png/flown-app-icon-maskable-512.png", 512)
    return dict(full=full, small=small, square=square, maskable=maskable)


# ---------------------------------------------------------------------------
# 3. Web / favicons / social
# ---------------------------------------------------------------------------
def web(icons):
    # favicon.svg - the full-bleed icon, simplified art (browsers show it tiny).
    write("web/favicon.svg", open(os.path.join(ROOT, icons["small"])).read())
    for px in (16, 32, 48):
        png(icons["small"], f"web/favicon-{px}x{px}.png", px)
    png(icons["square"], "web/apple-touch-icon.png", 180)
    png(icons["full"], "web/android-chrome-192x192.png", 192)
    png(icons["full"], "web/android-chrome-512x512.png", 512)
    png(icons["maskable"], "web/maskable-icon-512x512.png", 512)
    png(icons["full"], "web/mstile-150x150.png", 150)

    # Safari pinned tab / mono mask icon: single colour silhouette.
    defs, body = placed_mark("pt", 0, 0, 16, 0.92, "mono", "#000", low_shift=SMALL_SHIFT)
    write("web/safari-pinned-tab.svg", svg(16, 16, defs, body))

    write("web/site.webmanifest", json.dumps({
        "name": "Flown",
        "short_name": "Flown",
        "description": "Screen recorder & editor by Qbexel",
        "icons": [
            {"src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png"},
            {"src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png"},
            {"src": "/maskable-icon-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
        "theme_color": INK,
        "background_color": INK,
        "display": "standalone",
    }, indent=2) + "\n")

    # Social: Open Graph card and avatar.
    W, H = 1200, 630
    mx0, my0, mx1, my1 = MARK_BOX
    lw, lh = WORD_BOX[2] - mx0, my1 - my0
    s = 620 / lw
    tx, ty = (W - lw * s) / 2 - mx0 * s, (H - lh * s) / 2 - my0 * s
    defs, body = mark("og", s, tx, ty)
    bg = (f'<radialGradient id="og-g" cx="{W * 0.3}" cy="{H * 0.5}" r="520" gradientUnits="userSpaceOnUse">'
          f'<stop offset="0" stop-color="#5B4BFF" stop-opacity=".22"/>'
          f'<stop offset="1" stop-color="#5B4BFF" stop-opacity="0"/></radialGradient>')
    og = write("social/flown-og-1200x630.svg", svg(W, H, bg + defs,
               f'<rect width="{W}" height="{H}" fill="{INK}"/><rect width="{W}" height="{H}" fill="url(#og-g)"/>'
               + body + word(s, tx, ty, WHITE), "Flown"))
    png(og, "social/flown-og-1200x630.png", W, H)
    png(icons["square"], "social/flown-avatar-800.png", 800)


# ---------------------------------------------------------------------------
# 4. Tray / menu-bar icons
# ---------------------------------------------------------------------------
def tray():
    def glyph(color, badge=None, size=16):
        """Mono mark on a `size` square; optional bottom-right badge (knocked out)."""
        defs, body = placed_mark("t", 0, 0, size, 0.94, "mono", color, low_shift=SMALL_SHIFT)
        if not badge:
            return defs, body
        r = size * 0.21
        cx = cy = size - r
        cut = (f'<mask id="t-k" maskUnits="userSpaceOnUse" x="0" y="0" width="{size}" height="{size}">'
               f'<rect width="{size}" height="{size}" fill="#fff"/>'
               f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r + size / 16)}" fill="#000"/></mask>')
        body = f'<g mask="url(#t-k)">{body}</g>'
        if badge == "pause":
            bw, bh = r * 0.42, r * 1.3
            body += "".join(
                f'<rect x="{fmt(cx + dx - bw / 2)}" y="{fmt(cy - bh / 2)}" width="{fmt(bw)}" height="{fmt(bh)}" '
                f'rx="{fmt(bw / 3)}" fill="{color}"/>' for dx in (-r * 0.42, r * 0.42))
        elif badge == "rec":
            body += f'<circle cx="{fmt(cx)}" cy="{fmt(cy)}" r="{fmt(r)}" fill="{RECORD}"/>'
        return defs + cut, body

    out = {}
    for state, badge in (("idle", None), ("paused", "pause"), ("recording", "rec")):
        for tone, color in (("black", "#000000"), ("white", WHITE)):
            defs, body = glyph(color, badge)
            out[(state, tone)] = write(f"tray/svg/flown-tray-{state}-{tone}.svg", svg(16, 16, defs, body))

    # macOS: template images are black + alpha; the system tints them.
    for state, name in (("idle", "FlownTrayTemplate"), ("paused", "FlownTrayPausedTemplate")):
        png(out[(state, "black")], f"tray/macos/{name}.png", 16)
        png(out[(state, "black")], f"tray/macos/{name}@2x.png", 32)
    # Recording keeps its red dot, so it is not a template image: ship both tones.
    for tone in ("black", "white"):
        png(out[("recording", tone)], f"tray/macos/FlownTrayRecording-{tone}.png", 16)
        png(out[("recording", tone)], f"tray/macos/FlownTrayRecording-{tone}@2x.png", 32)

    # Windows + Linux: PNG strips (ICOs assembled by package.py).
    for (state, tone), rel in out.items():
        for px in (16, 20, 24, 32, 40, 48):
            png(rel, f"tray/windows/png/flown-tray-{state}-{tone}-{px}.png", px)
        for px in (22, 44):
            png(rel, f"tray/linux/flown-tray-{state}-{tone}-{px}.png", px)

    # Colour tray glyph (flat gradient mark, no tile) for platforms that allow it.
    defs, body = placed_mark("tc", 0, 0, 16, 0.94, "flat", low_shift=SMALL_SHIFT)
    rel = write("tray/svg/flown-tray-color.svg", svg(16, 16, defs, body))
    for px in (16, 20, 24, 32, 40, 48):
        png(rel, f"tray/windows/png/flown-tray-color-{px}.png", px)


# ---------------------------------------------------------------------------
# 5. Product UI icons - 24px grid, 1.75 stroke, round caps, currentColor.
# ---------------------------------------------------------------------------
UI = {
    # capture
    "record": '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
    "stop": '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
    "pause": '<rect x="6.5" y="5" width="3.5" height="14" rx="1.2"/><rect x="14" y="5" width="3.5" height="14" rx="1.2"/>',
    "play": '<path d="M8 5.6v12.8a.8.8 0 0 0 1.2.7l10-6.4a.8.8 0 0 0 0-1.4l-10-6.4a.8.8 0 0 0-1.2.7z"/>',
    "restart": '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
    "countdown": '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 10v3.5l2.5 1.5M9.5 3h5"/>',
    "screen": '<rect x="2.5" y="4" width="19" height="12.5" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/>',
    "window": '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M2.5 8.5h19M6 6.25h.01M8.5 6.25h.01M11 6.25h.01"/>',
    "region": ('<path d="M4 8.5V5.5A1.5 1.5 0 0 1 5.5 4h3M15.5 4h3A1.5 1.5 0 0 1 20 5.5v3M20 15.5v3a1.5 1.5 0 0 1-1.5 1.5h-3'
               'M8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3M12 9.5v5M9.5 12h5"/>'),
    "camera": '<circle cx="12" cy="10" r="7"/><circle cx="12" cy="10" r="2.5"/><path d="M8 21h8M12 17v4"/>',
    "camera-off": ('<path d="M7.1 5A7 7 0 0 1 17 14.9M15.6 16A7 7 0 0 1 6 6.4M8 21h8M12 17v4M3 3l18 18"/>'),
    "camera-bubble": '<rect x="2.5" y="4" width="19" height="16" rx="2.5"/><circle cx="16" cy="15" r="2.5"/>',
    "mic": '<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>',
    "mic-off": ('<rect x="9" y="2.5" width="6" height="11.5" rx="3"/>'
                '<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6M3 3l18 18"/>'),
    "system-audio": ('<path d="M4 9h3l4.5-4v14L7 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z"/>'
                     '<path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>'),
    "audio-off": '<path d="M4 9h3l4.5-4v14L7 15H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM16 9.5l5 5M21 9.5l-5 5"/>',
    # edit
    "cursor": '<path d="M5 4l5.6 15.5 2.3-6.6 6.6-2.3L5 4z"/>',
    "click": '<path d="M9.5 9.5l4.3 11 1.7-4.8 4.8-1.7-10.8-4.5zM5.5 5.5l1.5 1.5M9.5 2.5v2.2M2.5 9.5h2.2M14 4.5l-1.5 1.5M4.5 14l1.5-1.5"/>',
    "zoom": '<circle cx="10.5" cy="10.5" r="7"/><path d="M15.5 15.5L21 21M10.5 7.5v6M7.5 10.5h6"/>',
    "trim": '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8.2 7.8L20 17M8.2 16.2L20 7"/>',
    "split": '<rect x="3" y="7" width="6.5" height="10" rx="1.5"/><rect x="14.5" y="7" width="6.5" height="10" rx="1.5"/><path d="M12 3v18"/>',
    "speed": '<path d="M4.3 17.5a8.5 8.5 0 1 1 15.4 0"/><path d="M12 14l4-4"/><circle cx="12" cy="14" r="1.25" fill="currentColor" stroke="none"/>',
    "crop": '<path d="M7 2.5V17h14.5M2.5 7H17v14.5"/>',
    "captions": ('<rect x="2.5" y="5" width="19" height="14" rx="2.5"/>'
                 '<path d="M10.4 10.3a2.3 2.3 0 1 0 0 3.4M16.9 10.3a2.3 2.3 0 1 0 0 3.4"/>'),
    "blur": ('<path d="M12 3s-6.5 7-6.5 11.5a6.5 6.5 0 0 0 13 0C18.5 10 12 3 12 3z"/>'
             '<path d="M9 15a3 3 0 0 0 3 3"/>'),
    "annotate": '<path d="M4 20l1-4.5L15.6 4.9a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L8.5 19 4 20zM13.5 7l3.5 3.5"/>',
    "text": '<path d="M5 7V5h14v2M12 5v14M9.5 19h5"/>',
    "shapes": '<rect x="3" y="3" width="10.5" height="10.5" rx="2"/><circle cx="15.5" cy="15.5" r="5.5"/>',
    "background": '<rect x="2.5" y="3.5" width="19" height="17" rx="2.5"/><rect x="6.5" y="7.5" width="11" height="9" rx="1.5"/>',
    "sparkle": ('<path d="M11 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z"/>'
                '<path d="M18.5 15.5c.3 1.7 1 2.4 2.5 2.5-1.5.1-2.2.8-2.5 2.5-.3-1.7-1-2.4-2.5-2.5 1.5-.1 2.2-.8 2.5-2.5z"/>'),
    # share & manage
    "export": '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8M4.5 13.5v4A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5v-4"/>',
    "download": '<path d="M12 3.5V15M7.5 10.5L12 15l4.5-4.5M4.5 13.5v4A2.5 2.5 0 0 0 7 20h10a2.5 2.5 0 0 0 2.5-2.5v-4"/>',
    "upload-cloud": ('<path d="M7.5 18H7a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.2 10.5 3.75 3.75 0 0 1 17 18h-.5"/>'
                     '<path d="M12 21v-8.5M9 15.5l3-3 3 3"/>'),
    "link": ('<path d="M10 14a4 4 0 0 0 5.7 0l3-3A4 4 0 0 0 13 5.3l-1 1"/>'
             '<path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
    "comment": '<path d="M20.5 11.5a8 8 0 0 1-11.8 7L3.5 20l1.5-4.8a8 8 0 1 1 15.5-3.7z"/>',
    "library": '<path d="M3 7.5a2 2 0 0 1 2-2h4.2l2 2.2H19a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-10.5z"/>',
    "eye": ('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/>'
            '<circle cx="12" cy="12" r="2.75"/>'),
    "trash": '<path d="M4.5 6.5h15M9.5 6.5v-2h5v2M6.5 6.5l.8 12.1a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12.1"/>',
    # app
    "settings": '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    "keyboard": ('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/>'
                 '<path d="M6.5 10h.01M9.5 10h.01M12.5 10h.01M15.5 10h.01M8 14.5h8"/>'),
    "check": '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    "close": '<path d="M6 6l12 12M18 6L6 18"/>',
    "more": '<path d="M6 12h.01M12 12h.01M18 12h.01" stroke-width="2.5"/>',
}


def ui_icons():
    mx0, my0, mx1, my1 = MARK_BOX
    s = 20 / (my1 - my0)
    tx = 12 - (mx0 + mx1) / 2 * s
    ty = 12 - (my0 + my1) / 2 * s
    _, flown = mark("u", s, tx, ty, "mono", "currentColor")
    head = ('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" '
            'stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">')
    symbols = []
    for name, inner in list(UI.items()) + [("flown", flown.replace("<path ", '<path stroke="none" '))]:
        write(f"ui-icons/svg/{name}.svg", f"{head}{inner}</svg>\n")
        symbols.append(f'<symbol id="flown-{name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
                       f'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">{inner}</symbol>')
    write("ui-icons/flown-ui-icons.svg",
          '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">\n' + "\n".join(symbols) + "\n</svg>\n")
    return list(UI) + ["flown"]


# ---------------------------------------------------------------------------
# 6. Brand sheet (index.html) - previews every asset with download links.
# ---------------------------------------------------------------------------
PALETTE = [("Cyan", "#3FCBFF"), ("Azure", "#4D9BFF"), ("Indigo", "#6252FC"), ("Violet", "#8B3AFF"),
           ("Ink", INK), ("Ink 2", INK_2), ("White", WHITE), ("Record", RECORD)]


def sheet(names):
    def card(img, label, tone, links, cls=""):
        a = " · ".join(f'<a href="{href}">{txt}</a>' for txt, href in links)
        return (f'<figure class="card {tone} {cls}"><div class="art"><img src="{img}" alt="{label}"></div>'
                f'<figcaption><span>{label}</span><span class="dl">{a}</span></figcaption></figure>')

    def logo_card(name, label, tone, png_w, cls=""):
        return card(f"logo/svg/{name}.svg", label, tone,
                    [("SVG", f"logo/svg/{name}.svg"), ("PNG", f"logo/png/{name}-{png_w}.png"),
                     ("PDF", f"logo/pdf/{name}.pdf")], cls)

    logos_html = "".join([
        logo_card("flown-logo-horizontal-on-dark", "Horizontal · on dark", "dark", "2400w", "wide"),
        logo_card("flown-logo-horizontal-on-light", "Horizontal · on light", "light", "2400w", "wide"),
        logo_card("flown-logo-horizontal-white", "Horizontal · white", "dark", "2400w", "wide"),
        logo_card("flown-logo-horizontal-black", "Horizontal · black", "light", "2400w", "wide"),
        logo_card("flown-logo-stacked-on-dark", "Stacked · on dark", "dark", "1920w"),
        logo_card("flown-logo-stacked-on-light", "Stacked · on light", "light", "1920w"),
        logo_card("flown-mark", "Mark", "dark", "2048"),
        logo_card("flown-mark-flat", "Mark · flat", "light", "2048"),
        logo_card("flown-mark-white", "Mark · white", "dark", "2048"),
        logo_card("flown-mark-ink", "Mark · ink", "light", "2048"),
        logo_card("flown-wordmark-white", "Wordmark · white", "dark", "1860w", "wide"),
        logo_card("flown-wordmark-ink", "Wordmark · ink", "light", "1860w", "wide"),
    ])
    swatches = "".join(f'<div class="sw"><i style="background:{c}"></i><b>{n}</b><code>{c}</code></div>'
                       for n, c in PALETTE)
    apps = "".join([
        card("app-icon/svg/flown-app-icon-macos.svg", "macOS", "plain",
             [("SVG", "app-icon/svg/flown-app-icon-macos.svg"), (".icns", "app-icon/macos/Flown.icns")]),
        card("app-icon/svg/flown-app-icon.svg", "Windows / Linux", "plain",
             [("SVG", "app-icon/svg/flown-app-icon.svg"), (".ico", "app-icon/windows/Flown.ico")]),
        card("app-icon/svg/flown-app-icon-square.svg", "Square (iOS, stores)", "plain",
             [("SVG", "app-icon/svg/flown-app-icon-square.svg"), ("PNG", "app-icon/png/flown-app-icon-square-1024.png")]),
        card("app-icon/svg/flown-app-icon-maskable.svg", "Maskable (Android, PWA)", "plain",
             [("SVG", "app-icon/svg/flown-app-icon-maskable.svg"), ("PNG", "app-icon/png/flown-app-icon-maskable-512.png")]),
    ])
    ladder = "".join(f'<div class="rung"><img src="app-icon/macos/png/flown-macos-{px}.png" '
                     f'width="{min(px, 256)}" height="{min(px, 256)}" alt=""><span>{px}</span></div>'
                     for px in (16, 32, 64, 128, 256))
    tray_rows = ""
    for tone, bar in (("white", "dark"), ("black", "light")):
        cells = "".join(f'<span class="tr"><img src="tray/svg/flown-tray-{st}-{tone}.svg" width="16" height="16" alt="">'
                        f'<img src="tray/svg/flown-tray-{st}-{tone}.svg" width="32" height="32" alt=""><em>{st}</em></span>'
                        for st in ("idle", "paused", "recording"))
        tray_rows += f'<div class="menubar {bar}">{cells}</div>'
    sprite = open(os.path.join(ROOT, "ui-icons/flown-ui-icons.svg")).read()
    glyphs = "".join(f'<a class="glyph" href="ui-icons/svg/{n}.svg"><svg width="24" height="24">'
                     f'<use href="#flown-{n}"/></svg><span>{n}</span></a>' for n in names)

    html = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Flown Brand Kit</title>
<link rel="icon" href="web/favicon.svg" type="image/svg+xml">
<style>
:root {{ --ink:{INK}; --ink2:{INK_2}; --line:#262942; --text:#E9EAF5; --muted:#8B8FAE;
  --light:#F4F5FA; --grad:linear-gradient(110deg,#3FCBFF,#4D9BFF 30%,#6252FC 68%,#8B3AFF); }}
* {{ box-sizing:border-box }}
body {{ margin:0; background:var(--ink); color:var(--text);
  font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif }}
main {{ max-width:1180px; margin:0 auto; padding:56px 24px 96px }}
header {{ display:flex; flex-wrap:wrap; align-items:end; justify-content:space-between; gap:24px;
  padding-bottom:40px; border-bottom:1px solid var(--line) }}
header img {{ height:72px; max-width:100% }}
header p {{ margin:0; color:var(--muted); max-width:420px }}
h2 {{ font-size:13px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); margin:56px 0 18px }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:16px }}
.card {{ margin:0; border:1px solid var(--line); border-radius:16px; overflow:hidden; background:var(--ink2) }}
.card.wide {{ grid-column:span 2 }}
.art {{ height:200px; display:grid; place-items:center; padding:32px }}
.art img {{ width:100%; height:100%; object-fit:contain; min-height:0 }}
.dark .art {{ background:var(--ink) }}
.light .art {{ background:var(--light) }}
.plain .art {{ background:repeating-conic-gradient(#1b1d31 0 25%,#15172a 0 50%) 0 0/20px 20px; height:240px }}
figcaption {{ display:flex; justify-content:space-between; gap:12px; padding:12px 16px; font-size:13px;
  border-top:1px solid var(--line) }}
.dl a {{ color:var(--text); opacity:.75; text-decoration:none }} .dl a:hover {{ opacity:1; text-decoration:underline }}
.swatches {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(130px,1fr)); gap:12px }}
.sw {{ border:1px solid var(--line); border-radius:12px; overflow:hidden; background:var(--ink2); font-size:13px }}
.sw i {{ display:block; height:72px; border-bottom:1px solid var(--line) }}
.sw b, .sw code {{ display:block; padding:0 12px }} .sw b {{ padding-top:10px }}
.sw code {{ color:var(--muted); padding-bottom:10px }}
.gradient {{ height:56px; border-radius:12px; background:var(--grad); margin-top:12px }}
.ladder {{ display:flex; flex-wrap:wrap; align-items:end; gap:28px; margin-top:24px; padding:28px;
  border:1px solid var(--line); border-radius:16px }}
.rung {{ display:grid; justify-items:center; gap:8px; color:var(--muted); font-size:12px }}
.menubar {{ display:flex; gap:32px; flex-wrap:wrap; padding:14px 20px; border-radius:12px; margin-bottom:12px }}
.menubar.dark {{ background:#2A2C36; color:#ddd }} .menubar.light {{ background:#E9E9EE; color:#333 }}
.tr {{ display:flex; align-items:center; gap:12px; font-size:12px }} .tr em {{ font-style:normal; opacity:.7 }}
.icons {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(104px,1fr)); gap:8px }}
.glyph {{ display:grid; justify-items:center; gap:10px; padding:20px 8px 12px; border-radius:12px;
  border:1px solid var(--line); color:var(--text); text-decoration:none; font-size:11px }}
.glyph span {{ color:var(--muted) }} .glyph:hover {{ background:var(--ink2) }}
.notes {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:16px }}
.notes div {{ border:1px solid var(--line); border-radius:16px; padding:20px; color:var(--muted) }}
.notes b {{ color:var(--text); display:block; margin-bottom:6px }}
@media (max-width:600px) {{ .card.wide {{ grid-column:auto }} header img {{ height:52px }} }}
</style>
</head>
<body>
{sprite}
<main>
<header>
  <img src="logo/svg/flown-logo-horizontal-on-dark.svg" alt="Flown">
  <p>Brand kit for <b>Flown</b>, the screen recorder &amp; editor by Qbexel. Every asset is vector-first;
  PNG, PDF, ICO and ICNS files are exported from the SVG sources.</p>
</header>

<h2>Logo</h2>
<div class="grid">{logos_html}</div>

<h2>Colour</h2>
<div class="swatches">{swatches}</div>
<div class="gradient"></div>

<h2>App icon</h2>
<div class="grid">{apps}</div>
<div class="ladder">{ladder}</div>

<h2>Menu bar &amp; tray</h2>
{tray_rows}

<h2>Product icons · 24px · 1.75 stroke</h2>
<div class="icons">{glyphs}</div>

<h2>Usage</h2>
<div class="notes">
  <div><b>Clear space</b>Keep space equal to the height of the wordmark's "o" (about 40% of the mark's height) on every side.</div>
  <div><b>Minimum size</b>Horizontal logo: 96px / 25mm wide. Mark: 16px - use the small-size icon art below 48px.</div>
  <div><b>Backgrounds</b>Gradient mark on Ink or white. On photos or busy colour, use the solid white or black version.</div>
  <div><b>Don't</b>Recolour the blades, rotate or skew the mark, add effects, or re-set the wordmark in another typeface.</div>
</div>
</main>
</body>
</html>
"""
    write("index.html", html)


if __name__ == "__main__":
    logos()
    icons = app_icons()
    web(icons)
    tray()
    names = ui_icons()
    sheet(names)
    write("scripts/raster-manifest.json", json.dumps({"png": RASTER, "pdf": PDF, "ui": names}, indent=1) + "\n")
    print(f"{len(RASTER)} PNG + {len(PDF)} PDF exports queued, {len(names)} UI icons")
