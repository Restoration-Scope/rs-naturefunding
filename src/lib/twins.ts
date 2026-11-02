/** The Markdown twin of a page path: / → /index.md, /about/ → /about.md, /p/x/ → /p/x.md. */
export const twinPath = (path: string) => (path === '/' ? '/index.md' : `${path.replace(/\/$/, '')}.md`)

/** Marks where the build appends the prose pages' twins (how we check, open data) to llms-full.txt. */
export const LLMS_FULL_PAGES = '<!-- pages -->'
