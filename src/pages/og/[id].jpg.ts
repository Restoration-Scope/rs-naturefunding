import type { APIRoute, GetStaticPaths } from 'astro'
import type { Programme } from '../../data/schema'
import { programmes } from '../../lib/data'
import { hasOwnCard, renderCard } from '../../lib/og-card'

/** Each programme page's social card (og:image); src/lib/og-card.tsx draws it. */
export const getStaticPaths = (() =>
  programmes.filter(hasOwnCard).map((p) => ({ params: { id: p.id }, props: { p } }))) satisfies GetStaticPaths

export const GET: APIRoute = async ({ props }) =>
  new Response(new Uint8Array(await renderCard((props as { p: Programme }).p)), { headers: { 'Content-Type': 'image/jpeg' } })
