# Atelier Rouage — a watch that shows its work

A website for a fictional independent watchmaker in Besançon that makes one
watch, the R‑01 Petite Seconde. The watch on the page is not a picture: every
wheel, bridge, screw and hand is drawn in code, and it runs.

- **It tells your time.** The hands are set from your local clock. On arrival
  they sweep from 10:10:30 (the pose every watch has in its portrait) to now.
- **It beats.** The balance swings at 2.5 Hz and the escapement lets the train
  advance half a tooth per beat, so the seconds hand ticks five times a second.
  The wheels mesh at their true ratios (72:10, 64:8, 60:8, 60:6).
- **You can wind it.** Drag the crown, or focus it and press an arrow key: the
  ratchet turns a tooth at a time and the power-reserve hand climbs.
- **Scroll takes it apart.** The case, crystal, hands, dial, bridges, wheels
  and mainplate lift apart in 3D, each with its label, then close again.
- **The bench bends time.** The same train as a technical drawing: slow motion
  to follow one beat, time-lapse to watch the mainspring run down and the
  movement stop, and a button to wind it again. Optional ticking sound.
- **Finishing under the loupe.** Côtes de Genève, perlage, anglage and blued
  steel as samples that turn in the light.
- **Made to order.** Five dials, two case metals and four straps change both
  watches on the page.

> Atelier Rouage is a design concept. The company, the watch, its
> specification and its price are fictional. The waiting-list form sends
> nothing and asks for no payment details.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
npm run preview  # serve the production build
```

`?reduced` forces reduced motion.

## How it is built

Vite and vanilla JS modules, GSAP 3 (ScrollTrigger, SplitText), Lenis smooth
scroll, and Google Fonts (Archivo, Geist Mono). No images, no WebGL: the watch
is HTML, SVG and CSS, stacked in layers with CSS 3D transforms.

```
index.html                  the page; <!-- @watch id --> and <!-- @bench --> are drawn in at build time
vite.config.js              the plugin that draws them (calls the modules below in Node)
src/watch/train.js          geometry and kinematics of the going train and escapement (pure maths)
src/watch/parts.js          gear, spring, hand and bridge shapes as SVG path data (pure strings)
src/watch/markup.js         assembles the watch, one flat layer per level
src/watch/bench-markup.js   the same train as a line drawing
src/watch/watch.js          makes a drawn watch run: time, beat, light, winding, take-apart
src/sections/*.js           stage (hero + take-apart), bench, finish, config, list, nav
src/styles/*.css            tokens and shared pieces, the watch, the sections
```

Because the watch is written into `index.html` at build time, the page shows
it before any script runs, and still shows it (at ten past ten) with
JavaScript off.

The watch sizes itself in `em` (its font-size is 1/100 of its width), so the
whole drawing scales from one CSS length. Light comes from two custom
properties (`--lx`, `--ly`) that polished parts read in transforms only, so
moving the light never repaints anything.
