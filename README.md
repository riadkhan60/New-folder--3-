# Noctiluca — descend 10,935 metres

A scroll-driven website for a fictional deep-sea expedition company. Scrolling
the page *is* the dive: you start just under the surface of the Pacific, looking
up at the sun, and sink through the five layers of the ocean to the floor of the
Challenger Deep.

- The water colour, sunlight, marine snow and bioluminescence are driven by a
  live depth engine (`src/core/depth.js`).
- Display type is **compressed by pressure**: headlines in the variable font
  Anybody get narrower and heavier the deeper they sit (width 150 → 50).
- A dive-computer HUD reads live depth, pressure, temperature, light and zone.
- The submersible *Vesper* is built and lit in real time with three.js.
- In the abyss the lights go out and the pointer becomes the sub's lamp.
- From 6,000 m the page switches to the submersible's red observation lamps.
- Optional generative ambient sound (Web Audio, no audio files).

> Noctiluca is a design concept. The company, vessel, people and prices are fictional.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
npm run preview  # serve the production build
```

URL flags: `?skipintro` skips the loader, `?reduced` forces reduced motion.

## Stack

Vite · vanilla JS modules · GSAP 3 (ScrollTrigger, SplitText, DrawSVG) ·
Lenis smooth scroll · three.js · Google Fonts (Anybody, Newsreader).
No images or video: everything on the page is generated with SVG, canvas,
WebGL and CSS.

## Structure

```
index.html              page shell; sections are included from src/partials
src/main.js             boot: smooth scroll, shared context, module loader
src/core/depth.js       scroll → depth engine (colour, light, pressure, type)
src/core/*.js           ocean (WebGL), loader, nav, HUD, cursor, audio
src/sections/*.js       one module per section, each imports its own CSS
src/partials/*.html     static markup for each section
src/styles/base.css     design tokens, type scale, layout primitives
DESIGN.md               the design + engineering spec
```

Each module exports `init(ctx)` and is loaded in isolation, so a failure in one
section never takes down the page.
