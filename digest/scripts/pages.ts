// The site's finder pages by preset (country, region, project type), for the Worker's links. Imported as a macro
// in src/worker.ts, so the map is computed from data/ at bundle time and ships inside the script.
import { pagePaths } from '../../src/lib/finder-pages'
import type { PagePaths } from '../../src/lib/page-paths'

export const loadPagePaths = (): PagePaths => pagePaths
