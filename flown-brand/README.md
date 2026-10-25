# Flown — Brand Kit

Vector logo and full icon set for **Flown**, the desktop screen recorder & editor by Qbexel.

Open `index.html` in a browser to preview every asset with download links.

The logo was traced from the original artwork and redrawn as clean bezier curves. The mark matches the
original at 98% pixel overlap and the wordmark at 97%. The wordmark is drawn as outlines, so no font is needed.

## What's inside

```
logo/
  svg/   flown-mark(.svg | -flat | -white | -black | -ink)
         flown-logo-horizontal-(on-dark | on-light | white | black)
         flown-logo-stacked-(on-dark | on-light | white | black)
         flown-wordmark-(white | ink | black)
  png/   every SVG above at 3–4 sizes (transparent)
  pdf/   vector PDFs for print / Illustrator / Figma import
app-icon/
  svg/       macos, full-bleed, small-size (16–48px), square, maskable masters
  macos/     Flown.icns + Flown.iconset/ + png/
  windows/   Flown.ico (16–256) + png/ + tiles/ (Store / Start tiles)
  linux/     hicolor/<size>/apps/flown.png + scalable/apps/flown.svg
  png/       generic 64–1024 exports
web/         favicon.ico, favicon.svg, favicon-16/32/48, apple-touch-icon,
             android-chrome-192/512, maskable-icon-512, mstile-150,
             safari-pinned-tab.svg, site.webmanifest
tray/
  macos/     FlownTrayTemplate(.png | @2x), FlownTrayPausedTemplate, FlownTrayRecording-(black|white)
  windows/   .ico per state × tone (16–48) + png/
  linux/     22 / 44px PNGs
  svg/       sources (idle / paused / recording × black / white, plus colour)
ui-icons/
  svg/                    44 product icons (24px grid, 1.75 stroke, currentColor)
  flown-ui-icons.svg      sprite: <svg><use href="flown-ui-icons.svg#flown-record"/></svg>
social/      flown-og-1200x630 (Open Graph), flown-avatar-800
scripts/     generator (build.py → render.js → package.py)
```

## Colour

| Name   | Hex       | Use                                   |
| ------ | --------- | ------------------------------------- |
| Cyan   | `#3FCBFF` | gradient start (bottom of the mark)   |
| Azure  | `#4D9BFF` | gradient                              |
| Indigo | `#6252FC` | gradient                              |
| Violet | `#8B3AFF` | gradient end (top right of the mark)  |
| Ink    | `#0D0F1C` | primary background, dark wordmark     |
| Ink 2  | `#161829` | surfaces                              |
| White  | `#FFFFFF` | wordmark on dark                      |
| Record | `#FF4757` | recording state only                  |

## Using the icons in the app

**Electron (electron-builder):** set `mac.icon` → `app-icon/macos/Flown.icns`, `win.icon` → `app-icon/windows/Flown.ico`,
and `linux.icon` → `app-icon/linux/hicolor`. For the tray, use `nativeImage.createFromPath('tray/macos/FlownTrayTemplate.png')`.
Keep the `@2x` file beside it and the `Template` suffix, so macOS tints the icon for light and dark menu bars.
On Windows, use `tray/windows/flown-tray-idle-white.ico` for a dark taskbar or `-black.ico` for a light one.

**Tauri:** copy `Flown.icns` and `Flown.ico`, plus `app-icon/png/flown-app-icon-{128,256,512}.png` and
`app-icon/windows/tiles/*.png`, into `src-tauri/icons/`.

**Recording state:** switch the tray image to `FlownTrayRecording-*` while capturing and to `FlownTrayPausedTemplate` when paused.

**Web:** copy `web/` to the site root and add:

```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="mask-icon" href="/safari-pinned-tab.svg" color="#6252FC">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#0D0F1C">
```

## Usage rules

- **Clear space:** keep space equal to the height of the wordmark's "o" (about 40% of the mark's height) on every side.
- **Minimum size:** the horizontal logo should be at least 96px (25mm) wide. Below 48px, use the `*-small` icon art,
  which has a flat gradient and a wider gap between the blades.
- **Backgrounds:** put the gradient mark on Ink or white. On photos or busy colour, use the solid white or black logo.
- **Don't:** recolour the blades, rotate or skew the mark, add effects, or set the wordmark in another typeface.

## Rebuilding

The SVGs come from the master paths in `scripts/build.py`. To change the mark, colours or icons, edit that file, then run:

```bash
pip install pillow && npm i -D playwright   # once
python3 scripts/build.py      # writes all SVGs + index.html + raster manifest
node scripts/render.js        # exports PNG + vector PDF via headless Chromium
python3 scripts/package.py    # assembles .ico / .icns
```
