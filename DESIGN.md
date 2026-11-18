# Noctiluca — design & build spec

> Read this whole file before writing a line. It is the contract that keeps
> nine sections built in parallel looking like one site.

## 1. The idea in one sentence

**Scrolling the page *is* the dive.** The visitor starts just under the
surface of the Pacific, looking up at the sun, and every scroll takes them
deeper — through five layers of ocean — until they reach the floor of the
Challenger Deep, 10,935 metres down, where the reservation form is waiting.

Everything on the page is derived from that one mechanic:

| What changes with depth | How |
| --- | --- |
| Water colour | `body` background interpolates teal → indigo → true black (`--bg`, set by `depth.js`) |
| Light | sunlight rays and the surface window fade out by ~1,000 m (`--sun`) |
| Type | **pressure compression** — display type gets narrower and heavier with depth (Anybody `wdth` 150 → 50, `wght` 260 → 860; `--wdth`/`--wght` per section) |
| Instruments | a live HUD reads depth, pressure, temperature, light and zone |
| Light sources | below the sun, the only light is living light (bioluminescence) and, from 6,000 m, the submersible's red observation lamps (`--hadal`) |

That descent mechanic is the one bold thing. Everything else is quiet,
precise and in its service.

## 2. Brand facts (fictional — keep them consistent everywhere)

- **Company:** Noctiluca Deep Expeditions (say "Noctiluca"). Named after
  *Noctiluca scintillans*, the plankton that makes waves glow at night.
- **Base:** Apra Harbor, Guam. The Challenger Deep is roughly 300 km
  south-west of Guam, in the Mariana Trench.
- **Submersible:** **Vesper**. Two guests + one pilot. Full-ocean-depth rated
  (11,000 m). Titanium pressure sphere, 1.5 m internal diameter, 90 mm wall.
  Three acrylic viewports. 22 LED lamps (white + red observation mode).
  Descent ≈ 4 h, bottom time up to 4 h, ascent ≈ 4 h. 96 h emergency life support.
  Length 4.6 m, mass 11.7 t, syntactic-foam buoyancy, 10 thrusters.
- **Support ship:** **MV Lantern** (68 m).
- **Dive profiles (these are the products / prices):**
  | Profile | Max depth | Dive length | Trip length | Price (USD) | Seats per season |
  | --- | --- | --- | --- | --- | --- |
  | Twilight | 1,000 m | 5 h | 3 days | $48,000 | 40 |
  | Abyss | 5,500 m (abyssal plain) | 9 h | 6 days | $195,000 | 18 |
  | Hadal | 10,935 m (Challenger Deep) | 12 h | 9 days | $750,000 | 6 |
- **Season:** November to April (calmer weather window).
- **Primary action everywhere:** **"Reserve a dive"**. The form submit is also
  "Reserve a dive"; the confirmation says "Reservation request received".
- **Footer disclaimer (required):** "Noctiluca is a design concept. The
  company, vessel, people and prices on this page are fictional."

Real-world science is welcome and must be accurate. When unsure of a number,
round it or leave it out. Never invent quotes from real people or real
publications, and never use real brand logos.

## 3. Section map and ownership

Sections are contiguous. `depth.js` maps the viewport centre onto
`data-depth-start → data-depth-end` of the section underneath it.
**Keep the `id`, `data-depth-start`, `data-depth-end` exactly as below.**

| Order | Partial / module | `id` | Depth (m) | Job |
| --- | --- | --- | --- | --- |
| — | `core/loader` | — | — | the intro: "pressurising" the page, hand-over into the hero |
| — | `core/nav` | — | — | wordmark, anchors, sound toggle, "Reserve a dive" |
| — | `core/hud` | — | — | live depth instrument + depth ruler on the right edge |
| — | `core/cursor` | — | — | bioluminescent cursor trail (fine pointers only) |
| — | `core/audio` | — | — | generative ambient sound (off by default) |
| — | `core/ocean` | — | — | the global WebGL water: Snell's window, caustics, light shafts, marine snow |
| 1 | `hero` | `surface` | 0 → 0 | under the surface, looking up. The h1. |
| 2 | `manifesto` | `descent` | 0 → 200 | why go: one paragraph lit word-by-word as you sink |
| 3 | `zones` | `zones` | 200 → 1,000 | pinned horizontal pass through the five layers |
| 4 | `vessel` | `vessel` | 1,000 → 4,000 | Vesper in 3D (three.js), scroll-driven reveal + specs |
| 5 | `creatures` | `life` | 4,000 → 6,000 | lights off: the cursor is the sub's lamp, find the animals |
| 6 | `expedition` | `expedition` | 6,000 → 8,000 | the nine-day itinerary as a timeline; red-light mode begins |
| 7 | `profiles` | `dives` | 8,000 → 10,000 | prices drawn as dive-profile curves on a depth chart |
| 8 | `voices` | `voices` | 10,000 → 10,600 | three divers describe the bottom |
| 9 | `finale` | `reserve` | 10,600 → 10,935 | the floor. 10,935 m. Reservation form. |
| 10 | `footer` | `footer` | 10,935 | small print, disclaimer |

## 4. Colour

Tokens live in `src/styles/base.css`. Use them; do not invent new hues.

- Water: `--c-surface #0e6f86` → `--c-twilight #072a4a` → `--c-midnight #04142c`
  → `--c-abyss #01040b` → `--c-hadal #000000`. **The page background is
  owned by `depth.js` (`--bg`). Sections must be transparent** so the water
  shows through (no section background colours, except deliberate local
  effects like the creatures' darkness overlay).
- Ink: `--c-ink #eaf6f4` (plankton white), `--c-ink-2`, `--c-ink-3`, `--c-line`.
- Light sources — use them only where that light would really exist:
  - `--c-snell #d9fbff` sunlight. Hero + manifesto only.
  - `--c-photophore #6cf8e8` / `--c-photophore-2 #3aa8ff` bioluminescence.
    The default accent from 200 m down.
  - `--c-lure #ffb054` anglerfish lure. Rare, precious — a few highlights only.
  - `--c-redlight #ff3b2f` the sub's red observation lamps. Only from 6,000 m
    (expedition, profiles, voices, finale). Blend in with `var(--hadal)`.
- Glows are additive light, not drop shadows: `box-shadow`/`filter` glows in
  the light colour, `mix-blend-mode: screen|plus-lighter`, radial gradients.
  Never grey drop shadows.

## 5. Type

- **Anybody** (variable: `wdth` 50–150, `wght` 100–900) for display + UI.
  Use classes `.t-mega`, `.t-display`, `.t-h2`, `.t-h3` — they read the
  section's `--wdth`/`--wght` so pressure compression happens automatically.
  `.t-ui` for nav/buttons/labels (fixed width). `.t-num` for live numbers.
- **Newsreader** (variable, optical sizes, real italics) for reading text:
  `.t-lead`, `.t-body`, `.t-caption`.
- Sentence case everywhere. **No all-caps labels, no tracked-out eyebrows
  above headings.** If a heading needs context, put it in the sentence.
- Measure: body ≤ 62ch, lead ≤ 34ch-ish. Left-aligned; centred only for the
  hero h1 and the finale's depth figure.
- The type itself is the image: you may animate `font-stretch` /
  `font-weight` (e.g. a headline that compresses as it enters), split headings
  into characters with GSAP SplitText, etc. Don't add decorative fonts.

## 6. Layout

- Use `.wrap` for the content column (it reserves a right gutter
  `--instrument` for the depth ruler on desktop) and `.grid` (12 cols) inside.
- Asymmetric, left-weighted editorial layouts; generous vertical space
  (`--s-9`, `--s-10`). Big type, few elements per screen.
- Avoid the SaaS card kit: no rows of identical rounded cards with grey
  shadows. When content is a set, give it a form that comes from the subject
  (a depth chart, a ruler, a sonar sweep, a logbook, a specimen label).
- Numbered markers only for real sequences (itinerary days, zone depths).
  Depth figures are the natural numbering of this site — use metres.
- Mobile (≤ 767px) is first-class: single column, no horizontal pinning
  (stack instead), touch-friendly, nothing cut off, no horizontal overflow.

## 7. Motion

- Scroll is the timeline. Prefer `ScrollTrigger` with `scrub` for anything
  that represents descent; use time-based tweens for responses to the
  visitor (hover, click, reveal of one thing).
- One orchestrated intro (loader → hero). Don't add a generic
  fade-and-slide-up to every block; each section gets one signature motion
  idea that comes from its content.
- Easing: `ease-out` family (`power3.out`, `expo.out`, custom `"abyss"`), long
  durations (0.9–1.6 s), no bouncy/elastic eases.
- Organic idle motion (drift, pulse, bob) is allowed for living things and
  light only, and must be slow.
- `ctx.reducedMotion === true` → no smooth scroll (Lenis is null), no pins,
  no scrubbed transforms, no particles moving fast; show final states.

## 8. Copy

Plain, specific, calm, a little awe. Active voice. Short sentences. Say what
things are; don't sell. Metres with a thin space or normal space and "m"
(`10,935 m`). Use `°C`, `bar`. US English spelling *except* "metres" (brand
style). No exclamation marks. No "→" appended to links or buttons.

## 9. Engineering contract

### Files

- Each agent writes **only** its own files:
  `src/partials/<name>.html`, `src/sections/<name>.js` (or `src/core/<name>.js`),
  `src/styles/<name>.css`. Anything else is read-only (`index.html`,
  `main.js`, `depth.js`, `base.css`, `vite.config.js`, other agents' files).
- Each module file starts with `import '../styles/<name>.css'` and exports
  `export function init(ctx) {}` (may be `async`). Do not rename exports.
- Partials are plain HTML injected into `index.html` at build time
  (`<!-- @include name -->`). Section partials keep their outer `<section>`
  (or `<footer>`) with the exact `id` + `data-depth-*` attributes.
- **Scope all CSS** under your section's root (`#vessel …` or a prefixed
  class like `.vessel__x`). Never style bare elements globally, never touch
  `:root` tokens. Keep specificity low and predictable.
- Assets: no external images/video. Everything is generated — SVG, canvas,
  WebGL, CSS. (Fonts are already loaded in `index.html`.)
- Dependencies available: `gsap` (with ScrollTrigger, SplitText, CustomEase,
  DrawSVGPlugin registered in main.js — import from `gsap/...` if you need
  others, e.g. `MorphSVGPlugin`, and register them yourself), `lenis`,
  `three` (+ `three/addons/...`). No new npm packages.

### `ctx` (passed to every `init`)

```js
ctx.gsap, ctx.ScrollTrigger, ctx.SplitText   // registered GSAP + plugins
ctx.lenis            // Lenis instance or null (reduced motion)
ctx.depth            // see src/core/depth.js: get(), onChange(fn), compression(m), zoneAt(m), format(m), MAX, ZONES, refresh()
ctx.reducedMotion    // boolean
ctx.skipIntro        // boolean (?skipintro in URL, or reduced motion)
ctx.isTouch          // coarse pointer / no hover
ctx.isMobile()       // window.innerWidth < 768
ctx.dpr              // devicePixelRatio capped at 2
ctx.ready            // Promise: resolves when the intro hands over to the page
ctx.emit(name, detail) / ctx.on(name, fn)   // tiny event bus
ctx.scrollTo(targetOrSelector, opts)         // smooth scroll via Lenis
```

Known bus events (emit/listen as relevant):
- `sonar` — `{ x, y, strength }` a sonar ping happened (audio plays a ping; ocean may ripple).
- `lamp` — `{ on: boolean }` the sub's lamp/flashlight turned on/off (creatures section).
- `sound` — `{ on: boolean }` sound toggled (nav → audio).
- `select-profile` — `{ id: 'twilight' | 'abyss' | 'hadal' }` a dive profile was
  chosen (profiles → finale pre-selects it in the form, then scrolls there).

### Cursor contract

The custom cursor (`core/cursor`) reads the nearest `[data-cursor]` ancestor
of whatever is under the pointer:
- `data-cursor="hide"` — hide the custom cursor entirely.
- `data-cursor="lamp"` — hide the ring, keep only a tiny dot (the creatures
  section draws its own lamp).
- `data-cursor="drag"` / `data-cursor="view"` — ring grows and shows that word.
Links/buttons automatically enlarge the ring. Touch devices get no custom cursor.

### Loader contract

`html` starts with class `is-loading`. With `?skipintro` (or reduced motion)
`main.js` adds `skip-intro` to `html` and never calls the loader — the loader
overlay **must be hidden by CSS** under `html.skip-intro` and `html.is-ready`.

### Init timing

`main.js` loads all modules in parallel, then calls `init` in this order:
ocean, nav, hud, cursor, audio, hero … footer, then the loader. Intro
animations must wait for `ctx.ready`. Create ScrollTriggers inside `init`
(the page is laid out by then); `main.js` calls `ScrollTrigger.refresh()`
after fonts load and after the intro.

### Performance budget

- 60 fps on a laptop. One global WebGL canvas (`#ocean`). Additional WebGL
  (the vessel) and heavy canvases (creatures) must **only render while on
  screen** (IntersectionObserver / ScrollTrigger toggles) and pause when the
  tab is hidden.
- Cap DPR at `ctx.dpr` (≤ 2), lower on mobile. Reuse geometries. No layout
  thrash in scroll handlers (read then write; prefer transforms/opacity).
- Don't animate `font-stretch` on many elements every frame; a handful of
  big headlines is fine.

### Accessibility

- Semantic HTML: one `<h1>` (hero). Each section has one `<h2>`.
- All interactive things are real `<a>`/`<button>`/form controls, keyboard
  reachable, with visible `:focus-visible`.
- Decorative canvases/SVG get `aria-hidden="true"`. Meaningful content (the
  creatures' names, specs, prices) must also exist as real text in the DOM.
- Contrast: body text ≥ 4.5:1 against the water colour at that depth.

### QA

A shared dev server runs at `http://127.0.0.1:5173/` (Vite, live reload).
Append `?skipintro` to bypass the loader. Use the screenshot helper at the
path given in your task to check your work at 1440×900 and 390×844, and
check the browser console for errors. Run `npx vite build` before finishing —
it must succeed.
