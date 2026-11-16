import { expect, test } from 'bun:test'
import worker, { apex } from './worker'

test('www goes to the https apex, path and query kept', () => {
  expect(apex(new URL('https://www.naturefunding.org/p/green-spark-fund/?approach=x,y'))).toBe(
    'https://naturefunding.org/p/green-spark-fund/?approach=x,y',
  )
  expect(apex(new URL('http://www.naturefunding.org/'))).toBe('https://naturefunding.org/')
})

test('answers with a permanent redirect', () => {
  const res = worker.fetch(new Request('https://www.naturefunding.org/countries/'))
  expect(res.status).toBe(301)
  expect(res.headers.get('location')).toBe('https://naturefunding.org/countries/')
})
