// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'
import { proseTwins } from './src/integrations/prose-twins.ts'

/**
 * React renders the shadcn/ui components at build time only. The renderer gets no client
 * entrypoint, so the build ships no React runtime and no page can hydrate a React island
 * (tests/dist.test.ts checks the output).
 * @returns {import('astro').AstroIntegration}
 */
function reactAtBuildTime() {
  const integration = react()
  const setup = integration.hooks['astro:config:setup']
  return {
    ...integration,
    hooks: {
      ...integration.hooks,
      'astro:config:setup': (params) =>
        setup?.({ ...params, addRenderer: (renderer) => params.addRenderer({ ...renderer, clientEntrypoint: undefined }) }),
    },
  }
}

const preloadHelper = '\0vite/preload-helper.js'

/**
 * Vite wraps each `import()` in a helper (about 850 bytes gzipped, its own file on every page once two scripts use
 * `import()`) that preloads the lazy chunk's own imports and CSS. Astro already puts a script's CSS in the page, and
 * the browser fetches a chunk's imports when it loads it, so this swaps the helper for a bare call, written into
 * each script that uses it instead of a file of its own (tests/dist.test.ts).
 * @returns {import('vite').Plugin}
 */
function bareDynamicImports() {
  return {
    name: 'bare-dynamic-imports',
    apply: 'build',
    load: (id) => (id === preloadHelper ? 'export const __vitePreload = (load) => load()' : undefined),
    generateBundle(_, bundle) {
      const chunks = Object.values(bundle).filter((c) => c.type === 'chunk')
      const helper = chunks.find((c) => c.moduleIds.length === 1 && c.moduleIds[0] === preloadHelper)
      if (!helper) return
      const name = helper.exports[0]
      const from = `["'\`]\\./${helper.fileName.replace(/^.*\//, '').replaceAll('.', '\\.')}["'\`];?`
      const named = new RegExp(`import\\s*\\{\\s*${name}(?:\\s+as\\s+([\\w$]+))?\\s*\\}\\s*from\\s*${from}`)
      for (const c of chunks.filter((c) => c.imports.includes(helper.fileName))) {
        const m = c.code.match(named)
        if (!m) this.error(`${c.fileName}: can't inline ${helper.fileName}`)
        c.code = c.code.replace(named, `const ${m[1] ?? name}=(l)=>l();`)
      }
      delete bundle[helper.fileName]
    },
  }
}

// https://astro.build/config
export default defineConfig({
  integrations: [reactAtBuildTime(), proseTwins()],
  // Programme pages keep their one script inline (tests/dist.test.ts sets their budget); Vite's 4 KB default
  // would split it into a file once the page's contents list joined the Where view.
  vite: { plugins: [tailwindcss(), bareDynamicImports()], build: { assetsInlineLimit: 7000 } },
})
