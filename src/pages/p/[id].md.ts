import type { APIRoute, GetStaticPaths } from 'astro'
import type { Programme } from '../../data/schema'
import { programmeMarkdown } from '../../lib/agent'
import { programmes } from '../../lib/data'

export const getStaticPaths = (() => programmes.map((p) => ({ params: { id: p.id }, props: { p } }))) satisfies GetStaticPaths

export const GET: APIRoute = ({ props }) =>
  new Response(programmeMarkdown((props as { p: Programme }).p), { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
