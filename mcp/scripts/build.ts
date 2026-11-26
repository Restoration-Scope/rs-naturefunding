// Bundles the Worker into mcp/dist/worker.js with the programmes inlined. Run from the repo root: data/ is read there.
export {}
const result = await Bun.build({
  entrypoints: ['mcp/src/worker.ts'],
  outdir: 'mcp/dist',
  target: 'browser',
  conditions: ['workerd', 'worker', 'browser'],
  format: 'esm',
  minify: true,
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
for (const out of result.outputs) console.log(`${out.path}: ${(out.size / 1024).toFixed(0)} KB`)
