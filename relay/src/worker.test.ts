import { expect, test } from 'bun:test'
import { upstream } from './worker'

test('events and flags go to the API host, path and query kept', () => {
  expect(upstream(new URL('https://relay.naturefunding.org/e/?ip=0&ver=1')).toString()).toBe('https://us.i.posthog.com/e/?ip=0&ver=1')
  expect(upstream(new URL('https://relay.naturefunding.org/flags/?v=2')).host).toBe('us.i.posthog.com')
})

test('scripts and remote config come from the assets host', () => {
  expect(upstream(new URL('https://relay.naturefunding.org/static/array.js')).host).toBe('us-assets.i.posthog.com')
  expect(upstream(new URL('https://relay.naturefunding.org/array/phc_x/config.js')).host).toBe('us-assets.i.posthog.com')
})
