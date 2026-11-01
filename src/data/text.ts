/** How quotes are compared with page text. Shared by the schema, verify-quotes and the refresh job. */

/** Folds typography so a quote matches whatever quote marks, dashes and spaces the page used. */
export function normalise(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[­​-‍⁠﻿]/g, '')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−﹘﹣－]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export const comparable = (s: string) => normalise(s).toLowerCase()

/** A quote shorter than this, in non-space characters after folding, would match almost any page. */
export const MIN_QUOTE_CHARS = 8

export const meaningfulQuote = (quote: string) => normalise(quote).replace(/\s/g, '').length >= MIN_QUOTE_CHARS

/** Whether `quote` is on a page whose text is already `comparable`. A near-empty quote is never on a page. */
export const quoteOnPage = (page: string, quote: string) => meaningfulQuote(quote) && page.includes(comparable(quote))
