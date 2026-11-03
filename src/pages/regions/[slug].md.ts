import type { APIRoute, GetStaticPaths } from 'astro'
import { finderPageMarkdown } from '../../lib/agent'
import { finderPages, type FinderPage } from '../../lib/finder-pages'

export const getStaticPaths = (() =>
  finderPages.regions.map((page) => ({ params: { slug: page.path.split('/').at(-2)! }, props: { page } }))) satisfies GetStaticPaths

export const GET: APIRoute = ({ props }) =>
  new Response(finderPageMarkdown((props as { page: FinderPage }).page), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
