import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))

/**
 * Draws the watch and the bench diagram into index.html at dev and build
 * time. `<!-- @watch id -->` becomes a complete watch and `<!-- @bench -->`
 * the going-train diagram, so the page ships as static markup that shows the
 * watch before (and without) any script.
 */
function drawParts() {
  const load = (file) => import(pathToFileURL(path.join(root, file)).href + '?t=' + Date.now())
  return {
    name: 'rouage-draw-parts',
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        const { watchMarkup } = await load('src/watch/markup.js')
        const { benchMarkup } = await load('src/watch/bench-markup.js')
        return html
          .replace(/<!--\s*@watch\s+([\w-]+)(\s+lite)?\s*-->/g, (_, id, lite) => watchMarkup({ id, lite: !!lite }))
          .replace(/<!--\s*@bench\s*-->/g, () => benchMarkup())
      },
    },
    handleHotUpdate({ file, server }) {
      if (file.includes('/src/watch/')) server.ws.send({ type: 'full-reload' })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [drawParts()],
  server: { host: '127.0.0.1' },
  build: { target: 'es2022' },
})
