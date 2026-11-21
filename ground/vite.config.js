import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fieldCSS } from './src/core/pigments.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const partialsDir = path.join(root, 'src/partials')

/**
 * Tiny HTML-partials plugin: replaces `<!-- @include name -->` in index.html
 * with the contents of src/partials/name.html at dev + build time, so the
 * final page ships as fully static, crawlable HTML.
 */
function htmlPartials() {
  return {
    name: 'ground-html-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(/<!--\s*@include\s+([\w-]+)\s*-->/g, (_, name) => {
          const file = path.join(partialsDir, `${name}.html`)
          return fs.existsSync(file)
            ? fs.readFileSync(file, 'utf8')
            : `<!-- missing partial: ${name} -->`
        })
      },
    },
    handleHotUpdate({ file, server }) {
      if (file.startsWith(partialsDir)) {
        server.ws.send({ type: 'full-reload' })
        return []
      }
    },
  }
}

/**
 * Inlines the per-field colour variables (from src/core/pigments.js) into
 * <head>, so the colour fields exist before any script runs: no flash on
 * first paint, and the page keeps its colours without JavaScript.
 */
function fieldStyles() {
  return {
    name: 'ground-field-styles',
    transformIndexHtml: () => [
      { tag: 'style', attrs: { 'data-ground': 'fields' }, children: fieldCSS(), injectTo: 'head' },
    ],
  }
}

export default defineConfig({
  base: './',
  plugins: [htmlPartials(), fieldStyles()],
  server: { host: '127.0.0.1' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
