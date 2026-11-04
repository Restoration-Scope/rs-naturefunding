import rates from '../../data/rates.json'

/**
 * US dollars per unit of each currency, from the dated snapshot in data/rates.json
 * (scripts/data/sync-rates.ts). Only for sorting, size buckets and the worth-it check:
 * amounts always show as the funder wrote them.
 */
export const usdPerUnit: Record<string, number> = Object.fromEntries(
  Object.entries(rates.per_usd as Record<string, number>).map(([code, perUsd]) => [code, 1 / perUsd]),
)
export const ratesDate = rates.date
