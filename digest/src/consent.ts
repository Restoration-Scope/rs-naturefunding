// The words a person agrees to when they sign up, by version. The form sends the version it showed and the
// subscriber row keeps it. Versions are append-only: change the words by adding a version.
export const CONSENT = {
  v1: 'Email me new nature funding calls, at most once a week. I can unsubscribe at any time.',
} as const

export type ConsentVersion = keyof typeof CONSENT
export const CURRENT_CONSENT: ConsentVersion = 'v1'
export const isConsentVersion = (v: unknown): v is ConsentVersion => typeof v === 'string' && Object.hasOwn(CONSENT, v)
