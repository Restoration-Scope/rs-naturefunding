/**
 * The models the requirements pipeline calls, behind small interfaces so tests run with fakes:
 * - a JSON model (cheap extractor, strong escalator): Claude through the Anthropic SDK with structured
 *   outputs, or a Workers AI model through the refresh job's llm.ts;
 * - Jev (TypeSafe System One) for narrow typed checks.
 * Every call goes through a Ledger that counts tokens and dollars and stops at the run's spend cap,
 * and through a content-hash cache keyed by model, prompt version and input.
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { z } from 'zod'
import { llmFromEnv } from '../refresh/llm'

export type Usage = { input_tokens: number; output_tokens: number }

/** US dollars per million tokens, input and output. Claude Haiku 5.5 costs 5× above 100K input tokens; prompts stay under it. */
export const PRICES: Record<string, { input: number; output: number }> = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  '@cf/openai/gpt-oss-120b': { input: 0.35, output: 0.75 },
  'jev-latest': { input: 0.042, output: 0 },
}

/** Prompts over 100K tokens are billed on a higher card. */
const LONG: Record<string, { input: number; output: number }> = { 'claude-haiku-5-5': { input: 0.5, output: 2.5 } }

export const costOf = (model: string, u: Usage) => {
  const p = (u.input_tokens > 100_000 ? LONG[model] : undefined) ?? PRICES[model] ?? { input: 10, output: 50 }
  return (u.input_tokens * p.input + u.output_tokens * p.output) / 1e6
}

export class SpendCapError extends Error {}

/** A paid call that failed after the tokens were spent (refusal, out of tokens, an answer that breaks the schema). */
export class SpentError extends Error {
  constructor(message: string, readonly usage: Usage) {
    super(message)
  }
}

/** Token and dollar totals per model and per programme, with a cap on the run. */
export class Ledger {
  byModel: Record<string, Usage & { calls: number; usd: number; cached: number }> = {}
  byProgramme: Record<string, number> = {}
  constructor(readonly capUsd = Infinity) {}
  get total() {
    return Object.values(this.byModel).reduce((a, m) => a + m.usd, 0)
  }
  add(model: string, programme: string, u: Usage, cached = false) {
    const m = (this.byModel[model] ??= { input_tokens: 0, output_tokens: 0, calls: 0, usd: 0, cached: 0 })
    if (cached) {
      m.cached++
      return
    }
    const usd = costOf(model, u)
    m.input_tokens += u.input_tokens
    m.output_tokens += u.output_tokens
    m.calls++
    m.usd += usd
    this.byProgramme[programme] = (this.byProgramme[programme] ?? 0) + usd
  }
  /** Refuses a call whose likely cost would cross the cap, so the run stops before it, not after. */
  check(next = 0) {
    if (this.total + next > this.capUsd) throw new SpendCapError(`spend cap of $${this.capUsd} reached ($${this.total.toFixed(3)} spent, next call about $${next.toFixed(3)})`)
  }
}

/** Answers cached on disk by model, prompt version and input, so a rerun of unchanged pages costs nothing. */
export class Cache {
  constructor(readonly dir: string | null) {
    if (dir) mkdirSync(dir, { recursive: true })
  }
  key(...parts: unknown[]) {
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)
  }
  get<T>(key: string): T | undefined {
    if (!this.dir) return undefined
    const f = join(this.dir, `${key}.json`)
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : undefined
  }
  set(key: string, value: unknown) {
    if (this.dir) writeFileSync(join(this.dir, `${key}.json`), JSON.stringify(value))
  }
}

export interface JsonModel {
  name: string
  /** One answer that fits `schema`, or a thrown error. */
  json<T>(system: string, user: string, schema: z.ZodType<T>): Promise<{ value: T; usage: Usage }>
}

/** Claude through the Anthropic SDK, with the answer constrained to the schema (structured outputs). */
export function claudeModel(model: string, opts: { effort?: 'low' | 'medium' | 'high'; maxTokens?: number } = {}, client = new Anthropic()): JsonModel {
  return {
    name: model,
    async json(system, user, schema) {
      // Streamed, so long answers at high effort don't hit the request timeout; the schema still constrains the output.
      const stream = client.messages.stream({
        model,
        max_tokens: opts.maxTokens ?? 16000,
        system,
        messages: [{ role: 'user', content: user }],
        output_config: { format: zodOutputFormat(schema as z.ZodType<unknown> as never), ...(opts.effort ? { effort: opts.effort } : {}) },
      } as never)
      const r = (await stream.finalMessage()) as unknown as { stop_reason: string; content: { type: string; text?: string }[]; usage: Usage }
      const usage = { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens }
      if (r.stop_reason === 'refusal') throw new SpentError(`${model} declined the request`, usage)
      if (r.stop_reason === 'max_tokens') throw new SpentError(`${model} ran out of output tokens`, usage)
      const text = r.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
      try {
        return { value: schema.parse(JSON.parse(text)), usage }
      } catch (e) {
        throw new SpentError(`${model} answered outside the schema: ${(e as Error).message.slice(0, 200)}`, usage)
      }
    },
  }
}

/** A Workers AI model through the refresh job's client; the JSON is checked against the schema in code. */
export function workersModel(model?: string): JsonModel | null {
  const llm = llmFromEnv()
  if (!llm) return null
  const name = model ?? llm.extractor
  return {
    name,
    async json(system, user, schema) {
      const { value, usage } = await llm.chatWithUsage(name, `${system}\nAnswer with one JSON object only.`, user)
      const ok = schema.safeParse(value)
      if (!ok.success) throw new SpentError(`${name} answered outside the schema: ${ok.error.message.slice(0, 200)}`, usage)
      return { value: ok.data, usage }
    },
  }
}

export type NoulQ = { type: 'noul'; instructions: unknown; criteria?: { true: string; false: string } }
export type ChoiceQ = { type: 'choice'; instructions: unknown; criteria: Record<string, string> }
export type Question = NoulQ | ChoiceQ
export type Answer = { type: 'noul'; noul: number } | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> }

export interface Jev {
  name: string
  ask(state: unknown, questions: Record<string, Question>): Promise<{ answers: Record<string, Answer>; usage: Usage }>
}

/** TypeSafe's System One endpoint (https://docs.typesafe.ai/api/system-one). Retries 429 and 529 with backoff. */
export function typesafeJev(key = process.env.TYPESAFE_API_KEY, model = 'jev-latest'): Jev | null {
  if (!key) return null
  return {
    name: model,
    async ask(state, questions) {
      const body = JSON.stringify({ model, state, questions })
      // State over the 64K default context needs the long-context header; pages are chunked to stay under it.
      const long = body.length > 180_000
      for (let attempt = 0; ; attempt++) {
        const res = await fetch('https://api.typesafe.ai/v1/systemone', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(long ? { 'TypeSafe-Danger-Zone-Long-Context': 'true' } : {}) },
          body,
          signal: AbortSignal.timeout(120_000),
        })
        if ((res.status === 429 || res.status === 529) && attempt < 5) {
          await Bun.sleep(Math.min(Number(res.headers.get('retry-after') ?? 2 ** attempt), 60) * 1000)
          continue
        }
        const text = await res.text()
        if (!res.ok) throw new Error(`TypeSafe HTTP ${res.status}: ${text.slice(0, 300)}`)
        const json = JSON.parse(text) as { answers: Record<string, Answer>; usage: Usage }
        return { answers: json.answers, usage: { input_tokens: json.usage.input_tokens, output_tokens: json.usage.output_tokens } }
      }
    },
  }
}

/** Wraps a model so every call is cached by its input and counted in the ledger under one programme. */
export function metered(m: JsonModel, ledger: Ledger, cache: Cache, version: string) {
  return async <T>(programme: string, system: string, user: string, schema: z.ZodType<T>): Promise<T> => {
    const key = cache.key(m.name, version, system, user)
    const hit = cache.get<T>(key)
    if (hit !== undefined) {
      ledger.add(m.name, programme, { input_tokens: 0, output_tokens: 0 }, true)
      return schema.parse(hit)
    }
    // About 3.5 characters a token in, and a typical answer of 4K tokens out.
    ledger.check(costOf(m.name, { input_tokens: Math.ceil((system.length + user.length) / 3.5), output_tokens: 4000 }))
    let got: { value: T; usage: Usage }
    try {
      got = await m.json(system, user, schema)
    } catch (e) {
      if (e instanceof SpentError) ledger.add(m.name, programme, e.usage)
      throw e
    }
    const { value, usage } = got
    ledger.add(m.name, programme, usage)
    cache.set(key, value)
    return value
  }
}

export function meteredJev(j: Jev, ledger: Ledger, cache: Cache, version: string) {
  return async (programme: string, state: unknown, questions: Record<string, Question>): Promise<Record<string, Answer>> => {
    const key = cache.key(j.name, version, state, questions)
    const hit = cache.get<Record<string, Answer>>(key)
    if (hit) {
      ledger.add(j.name, programme, { input_tokens: 0, output_tokens: 0 }, true)
      return hit
    }
    // Jev reads the state once per question.
    ledger.check(costOf(j.name, { input_tokens: Math.ceil(JSON.stringify([state, questions]).length / 3.5) * Math.max(1, Object.keys(questions).length), output_tokens: 0 }))
    const { answers, usage } = await j.ask(state, questions)
    ledger.add(j.name, programme, usage)
    cache.set(key, answers)
    return answers
  }
}

export type Ask = ReturnType<typeof metered>
export type AskJev = ReturnType<typeof meteredJev>
