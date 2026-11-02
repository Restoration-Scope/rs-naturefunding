import { expect, test } from 'bun:test'
import { approachLabels, projectTypes } from './labels'

test('every approach belongs to exactly one project type', () => {
  const grouped = projectTypes.flatMap((t) => t.approaches).sort()
  expect(grouped).toEqual(Object.keys(approachLabels).sort() as typeof grouped)
})
