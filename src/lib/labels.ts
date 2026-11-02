import type { Programme } from '../data/schema'

type Approach = Programme['approaches'][number]
type Applicant = NonNullable<Programme['applicant_types']>[number]
type Access = Programme['access']

export const approachLabels: Record<Approach, string> = {
  reforestation: 'Reforestation',
  agroforestry: 'Agroforestry',
  natural_regeneration: 'Natural regeneration',
  mangroves: 'Mangroves',
  wetlands: 'Wetlands',
  grasslands: 'Grasslands and savannas',
  peatlands: 'Peatlands',
  coastal_marine: 'Coasts and oceans',
  freshwater: 'Rivers and lakes',
  species_conservation: 'Species conservation',
  protected_areas: 'Protected areas',
  community_conservation: 'Community conservation',
  sustainable_land_use: 'Sustainable land use',
  urban_nature: 'Urban nature',
  research: 'Research',
}

export const applicantLabels: Record<Applicant, string> = {
  ngo: 'NGOs',
  community_group: 'Community groups',
  indigenous_organization: 'Indigenous organisations',
  research_institution: 'Research institutions',
  individual: 'Individuals',
  government: 'Government bodies',
  social_enterprise: 'Social enterprises',
  company: 'Companies',
}

export const accessLabels: Record<Access, string> = {
  direct: 'Apply directly',
  intermediary: 'Through a partner',
  invitation_only: 'Invitation only',
  unspecified: 'Route not stated',
}

export const accessHelp: Record<Access, string> = {
  direct: 'When a call is open, eligible applicants apply to the funder or the organisation running the call.',
  intermediary: 'The money reaches projects through partners, such as country programmes. You apply to the partner, not the funder.',
  invitation_only: 'The funder picks its grantees and does not take unsolicited proposals.',
  unspecified: 'The funder’s page does not say how to apply.',
}

export type State = 'open' | 'rolling' | 'upcoming' | 'closed' | 'none'

export const stateLabels: Record<State, string> = {
  open: 'Open',
  rolling: 'Rolling',
  upcoming: 'Upcoming',
  closed: 'Closed',
  none: 'No call found',
}

export const stateFilterLabels: Record<State, string> = {
  open: 'Open now',
  rolling: 'Rolling, apply any time',
  upcoming: 'Upcoming',
  closed: 'Closed',
  none: 'No call found',
}

export type SizeBucket = 'small' | 'medium' | 'large'

/** Grant-size buckets in rough US dollars. Only used to filter; amounts are always shown in the funder's currency. */
export const sizeBuckets: Record<SizeBucket, { label: string; min: number; max: number }> = {
  small: { label: 'Under $25,000', min: 0, max: 25000 },
  medium: { label: '$25,000 to $250,000', min: 25000, max: 250000 },
  large: { label: 'Over $250,000', min: 250000, max: Infinity },
}

// The home header's project types: each groups approaches, and picking one sets the Approach filter to them.
// Every approach belongs to exactly one type (src/lib/labels.test.ts).
export const projectTypes: { key: string; label: string; approaches: Approach[] }[] = [
  { key: 'forests', label: 'Forests', approaches: ['reforestation', 'agroforestry', 'natural_regeneration'] },
  { key: 'coasts', label: 'Coasts', approaches: ['mangroves', 'coastal_marine'] },
  { key: 'wetlands', label: 'Wetlands', approaches: ['wetlands', 'peatlands', 'freshwater'] },
  { key: 'grasslands', label: 'Grasslands', approaches: ['grasslands'] },
  { key: 'wildlife', label: 'Wildlife', approaches: ['species_conservation', 'protected_areas'] },
  { key: 'communities', label: 'Communities', approaches: ['community_conservation', 'sustainable_land_use'] },
  { key: 'cities', label: 'Cities', approaches: ['urban_nature'] },
  { key: 'research', label: 'Research', approaches: ['research'] },
]
