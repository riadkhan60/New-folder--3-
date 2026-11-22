# Ground — design & build spec

> Read this whole file before writing a line. It keeps seven sections built
> in parallel looking like one site.

## 1. The idea

**The page is a dish of water, and every colour is poured into it.**

Ground is a (fictional) London artists' colourman that makes historic
pigments by hand, from the materials colour has always come from: earth,
stone, shell, insect, plant, bone. Behind every section runs one live fluid
simulation — the dish (`canvas#dish`). As the visitor scrolls into a chapter,
that chapter's pigment is poured in: it blooms, swirls and settles until the
whole screen is a full-bleed field of that one colour, like a painter's
swatch. The cursor (or finger) always stirs the water.

The one bold thing is colour itself: six huge saturated fields (ochre,
Egyptian blue, Tyrian purple, ultramarine, carmine, bone black), separated
by paper. Everything else — type, layout, chrome — is quiet, precise and
printed, like an old colourman's catalogue.

## 2. Brand facts (fictional — keep consistent)

- **Name:** Ground. Wordmark "Ground" in Bodoni Moda italic. Line: "Pigments,
  ground by hand."
- **Workshop:** Clerkenwell, London EC1 (no street address: the company is fictional). Est. 2011. Two people grind every batch
  on a glass slab with a glass muller.
- **What they sell:** loose dry pigment in glass jars (prices and jar sizes in
  `src/core/pigments.js`), plus three sets: "The earths" (yellow ochre, red
  ochre, bone black, £36), "The blues" (Egyptian blue, ultramarine, indigo,
  £220), "The full library" (every pigment that is sold, £2,800 — Tyrian purple
  included; always cheaper than the nine jars bought separately, £2,936). UK prices in pounds. Ships worldwide.
- **Archive only:** toxic historic pigments (orpiment, vermilion, lead white)
  appear in the library with their story but are never sold. Say so plainly.
- **Primary action:** "Order pigments" (nav) → the shop. Shop buttons:
  "Add to order". The order form submit: "Place order"; confirmation:
  "Order placed" (no backend; never take real payment details — ask only for
  name, email, country; say "We'll email a payment link").
- **Required footer disclaimer:** "Ground is a design concept. The company,
  its workshop and its prices are fictional. The history and chemistry are real."

All pigment facts live in `src/core/pigments.js`. Use them; don't invent new
facts. If you add one, it must be accurate and conservative.

## 3. Section map and ownership

`palette.js` decides the current field from `data-field` on each top-level
section (probe at 85% of the viewport height; the field hands over while the
incoming section's top moves from 85% to 65% of the viewport, flipping at
75% — so the pour plays over the empty tail of the outgoing section). **Keep every `id` and `data-field` below.**

| Order | Partial / module | `id` | `data-field` | Job |
| --- | --- | --- | --- | --- |
| — | `core/loader` | — | — | intro: one drop of ultramarine falls into clear water |
| — | `core/nav` | — | — | wordmark, anchors, "Order pigments" |
| — | `core/cursor` | — | — | the stirring cursor (fine pointers) |
| — | `core/dish` | — | — | the global WebGL fluid simulation |
| 1 | `hero` | `top` | paper | the h1, a bloom of ultramarine in water |
| 2 | `intro` | `intro` | paper | where colour comes from: the six sources |
| 3 | `chapters` (one partial, six sections inside `#chapters`) | `yellow-ochre`, `bone-black`, `egyptian-blue`, `tyrian-purple`, `ultramarine`, `carmine` (this order: oldest to newest, = `CHAPTERS`) | same as id | six full-bleed colour chapters, oldest to newest |
| 4 | `library` | `library` | paper | all twelve pigments as a swatch library |
| 5 | `grind` | `grind` | paper | lab: grind lapis into ultramarine yourself |
| 6 | `mix` | `mix` | paper | lab: mix two pigments like paint, not like light |
| 7 | `shop` | `shop` | paper | jars on a shelf, sets, the order form |
| 8 | `footer` | `footer` | bone-black | small print, disclaimer |

## 4. Colour

- The dish paints the page. **Sections are transparent** and use the field
  variables for everything: `--ink` (text), `--ink-2`, `--ink-3`, `--line`,
  `--field` (the field colour), `--tint` (a thin wash of it). palette.js sets
  these per `[data-field]`, so text is always legible on its own field.
  `--ink-2` and `--ink-3` are the ink at 0.84 and 0.68 alpha, raised per field
  wherever that would read below 4.5:1 on the field (`fieldCSS()` in
  `pigments.js`: Egyptian blue takes about 0.9 for both). Small text uses
  `--ink`, `--ink-2` or `--ink-3` only: no lower alpha, no opacity on text.
- Pigment colours come only from `pigments.js` (`hex` masstone, `tint`
  wash). Paper is `#f3f2ee`, ink `#151413`. No other hues, no gradients as
  decoration, no grey drop shadows. Depth comes from the medium: powder,
  wet paint, glass, paper grain, light.
- Without WebGL (`html.no-dish`), sections paint their own `--field`.

## 5. Type

- **Bodoni Moda** (variable, optical sizes 6–96, weights 400–900, real
  italics) for display: `.t-mega`, `.t-display`, `.t-h2`, `.t-h3`. Colour names
  are set in *italic* — that is the house voice. Formulas: `.t-formula` with
  real `<sub>`.
- **Hanken Grotesk** for text and UI: `.t-lead`, `.t-body`, `.t-label`,
  `.t-caption`, `.t-num` (tabular numbers for prices/dates).
- Sentence case everywhere; UK English ("colour", "grey", "centre").
  **No all-caps labels, no tracked eyebrows, no "→" on buttons, no
  "A · B · C" meta strings, no "WORD — fragment" labels, no exclamation marks.**
- Numbers that are a real sequence (chapter order by age, dates) may be
  shown; don't number things that aren't a sequence.

## 6. Layout

- `.wrap` + `.grid` (12 columns). Asymmetric, generous, editorial. Big type,
  few elements per screen. Full-bleed colour fields; content sits in them like
  type on a swatch card.
- Avoid the SaaS card kit (rows of identical rounded cards with shadows).
  When content is a set, give it a form from the subject: a swatch book, a
  drawdown, a specimen jar, a catalogue page, a label.
- Mobile (≤ 767 px) is first-class: one column, touch-friendly, no
  horizontal overflow (check `scrollWidth` vs `clientWidth`).

## 7. Motion

- Liquid, never bouncy. Eases: `"pour"`, `"settle"`, `power3.out`, `expo.out`;
  0.8–1.6 s for entrances. The fluid is the main motion; DOM motion supports it.
- One orchestrated intro (loader → hero). Each section gets one signature
  motion idea from its content — no generic fade-up on every block.
- `ctx.reducedMotion === true` → no smooth scroll, no pins, no scrubbed
  transforms, the dish renders calm still fields; show final states.

## 8. The dish contract (core/dish)

- `canvas#dish` is fixed, full-screen, behind `<main>`. It runs a GPU fluid
  simulation (velocity + dye, advection, pressure projection, vorticity).
- It follows `ctx.palette.onChange(state)`: when the field changes it **pours**
  the new pigment (splats from an edge or a point, then relaxes the whole dish
  towards the new field colour over ~1.5–2.5 s, keeping marbled streaks of
  `--tint` for a while). On paper it relaxes to paper slowly, so drops linger.
- It listens to `ctx.on('drop', { id, x, y, amount, radius, vx, vy })` — x/y in
  0..1 viewport units (default centre) — to drop pigment anywhere (hero bloom,
  library hover, mix lab…).
- It listens to pointer movement itself (stirring) and to
  `ctx.on('stir', { x, y, dx, dy, strength })` for programmatic stirring.
- Text must stay readable: dye under content settles to the uniform field.
- Exposes nothing else. If WebGL is missing it adds `html.no-dish` and stops.

Bus events: `drop`, `stir` (above), `order` — `{ id, qty }` an item was added
to the order (shop listens; anything may emit), `select-pigment` — `{ id }`
(library → mix lab, optional), and:

- `jump` — `{ phase: 'start' }`, then `{ phase: 'end', reason }` (main.js
  emits). Every programmatic smooth scroll is a jump: anchor and nav links,
  the skip link, back and forward, and `ctx.scrollTo(target, opts)` unless
  `opts.immediate`. While it runs `ctx.jumping` is true and the palette holds
  `field`, `from`, `to`, `mix`, `color` and `ink` at their values from when it
  started (`section`, `progress` and `velocity` keep updating, and listeners
  are still notified). It ends when the scroll arrives, when the visitor takes
  over (wheel, touch, a press outside an in-page link, scrolling keys), when
  something else stops the scroll, or at the latest its duration + 600 ms
  after it began. Then `ctx.jumping` is false, the palette recomputes at once
  (listeners see one change, straight from the origin field to the
  destination) and `end` is emitted. So the dish makes one clean pour of the
  destination, or one clean wipe when it is paper, and never pours the fields
  passed on the way. Starts and ends are always balanced: a jump that replaces
  another ends it first, and the palette stays held across the hand-over.
  `ctx.scrollTo(y, { immediate: true })` is not a jump: it lands in one frame
  and the palette follows it like any scroll.
- `tone` — `{ field }` (grind emits, nav listens). `{ field: 'ultramarine' }`
  when the grind flood has filled the screen and the lab's text re-inks to the
  light ink; `{ field: null }` when the wash-out re-inks it to paper ink. While
  an override is set the nav (ink, band and CTA) tones exactly as if the
  palette's field were that pigment; it drops the override on `null`, when the
  palette's section is no longer `grind`, or when a jump starts.

main.js also keeps the reader's place when the window's size or orientation
changes (on phones and tablets, height-only changes under 120 px, the
toolbars, are ignored): it keeps a reading anchor (the first block of text
under the nav, or the paragraph being read) while scrolling and puts it back
once the new layout settles, holding the palette meanwhile. Sections that
re-lay themselves out on resize should do so in a ResizeObserver or on
ScrollTrigger's refresh, which it waits for.

## 9. Engineering contract

- Each agent writes **only** its own files:
  `src/partials/<name>.html`, `src/sections/<name>.js` (or `src/core/<name>.js`),
  `src/styles/<name>.css`. Everything else is read-only.
- Each module starts with `import '../styles/<name>.css'` and exports
  `init(ctx)`. Scope all CSS under your section root or a prefix
  (`.hero__…`, `#mix …`). Never style bare elements globally.
- No external images, video or fonts beyond those loaded. Everything is
  generated: SVG, canvas, WebGL, CSS.
- Dependencies: `gsap` (ScrollTrigger, SplitText, CustomEase, DrawSVG
  registered), `lenis`, `spectral.js` (Kubelka–Munk pigment mixing, MIT). No
  other packages.
- `ctx`: `gsap, ScrollTrigger, SplitText, lenis, palette, pigments,
  reducedMotion, skipIntro, isTouch, isMobile(), dpr, ready, jumping, emit,
  on, scrollTo`. `ctx.pigments` = `{ PIGMENTS, BY_ID, CHAPTERS, PAPER,
  SOURCES, formatPrice, fieldCSS, inkAlpha, contrast }`. `ctx.jumping` is true
  while a jump runs (§8).
- Heavy work (WebGL, big canvases) never runs synchronously in `init()`:
  defer to `ctx.ready` or near-view. Render only while on screen; pause when
  the tab is hidden; cap DPR at `ctx.dpr`.
- Accessibility: one `<h1>` (hero); one `<h2>` per section (each chapter's
  pigment name is its h2). Real buttons/links/form controls, visible
  `:focus-visible`, decorative canvases `aria-hidden`, all facts as real text.

## 10. QA

Build your own frozen copy (`cd ground && npx vite build --outDir <scratch>/dist`)
and serve it with `npx vite preview --outDir <scratch>/dist --port <yours>
--strictPort --host 127.0.0.1`. `?skipintro` skips the loader, `?reduced`
forces reduced motion. `window.__ground` exposes ctx.
