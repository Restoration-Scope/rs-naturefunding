// @ts-check
import { defineConfig } from 'astro/config'
import react from '@astrojs/react'
import tailwindcss from '@tailwindcss/vite'

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

// https://astro.build/config
export default defineConfig({
  integrations: [reactAtBuildTime()],
  vite: { plugins: [tailwindcss()] },
})
