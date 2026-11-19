import { defineConfig } from 'vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const partialsDir = path.join(root, 'src/partials')

/**
 * Tiny HTML-partials plugin: replaces `<!-- @include name -->` in index.html
 * with the contents of src/partials/name.html at dev + build time, so the
 * final page ships as fully static, crawlable HTML.
 */
function htmlPartials() {
  return {
    name: 'noctiluca-html-partials',
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
 * Preload the chunks the first screen needs (loader, nav, HUD, ocean, hero,
 * and what they import, e.g. three.js) so the browser fetches them in
 * parallel with the entry instead of discovering them one after another.
 */
const FIRST_SCREEN = /\/src\/(core\/(loader|nav|hud|ocean)|sections\/hero)\.js$/
function preloadFirstScreen() {
  return {
    name: 'noctiluca-preload-first-screen',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle) return html
        const chunks = Object.values(ctx.bundle).filter((c) => c.type === 'chunk')
        const byName = new Map(chunks.map((c) => [c.fileName, c]))
        const want = new Set()
        const add = (c) => {
          if (!c || want.has(c.fileName) || c.isEntry) return
          want.add(c.fileName)
          for (const f of c.imports || []) add(byName.get(f))
        }
        for (const c of chunks) if (c.facadeModuleId && FIRST_SCREEN.test(c.facadeModuleId)) add(c)
        const tags = [...want].map((f) => ({
          tag: 'link',
          attrs: { rel: 'modulepreload', crossorigin: true, href: `./${f}` },
          injectTo: 'head',
        }))
        return { html, tags }
      },
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [htmlPartials(), preloadFirstScreen()],
  server: { host: '127.0.0.1' },
  // ground/ is a separate project with its own dependencies
  optimizeDeps: { entries: ['index.html'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
})
