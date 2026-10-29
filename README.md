# All my projects

A small portfolio page: a 3D glass world (Three.js) behind frosted-glass panes that hold
each project.

## Run it

The page uses ES modules, so open it through a local server rather than from the file
system. Any static server works:

```sh
npx serve .
```

Then open the printed address (for example http://localhost:3000).

## What is where

- `index.html`: the page. Three.js is loaded from a CDN through the import map in the head.
- `style.css`: the glass design (tokens at the top).
- `script.js`: entry point. Picks a quality tier, starts the world, wires the UI.
- `js/world.js`: the 3D world (sky, mirror sea, glass forms, lanterns, dust, bloom).
- `js/ui.js`: pane tilt and glare, the pause button, scroll and pointer feed.
- `Src/Imgs/`: project screenshots.

## Behaviour notes

- Phones and low-end devices get a lighter world (no refraction, no bloom). Force a tier
  with `?quality=high` or `?quality=low`.
- If a device cannot keep up, bloom, then the mirror sea, then resolution are dropped.
  Add `?adapt=0` to switch that off.
- `prefers-reduced-motion` starts the world paused on a still frame. The button in the
  corner pauses or resumes it at any time.
- If WebGL or the CDN is unavailable, the page falls back to a flat gradient sky.
