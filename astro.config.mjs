// @ts-check
import { defineConfig } from 'astro/config';
import { proseTwins } from './src/integrations/prose-twins.ts';

// https://astro.build/config
export default defineConfig({
  integrations: [proseTwins()],
});
