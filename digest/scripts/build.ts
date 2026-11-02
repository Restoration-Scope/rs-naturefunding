// Bundles the Worker into digest/dist/worker.js with the programmes and the digest events inlined.
// Run from the repo root: data/ and git history are read there.
export {}
const result = await Bun.build({
  entrypoints: ['digest/src/worker.ts'],
  outdir: 'digest/dist',
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
