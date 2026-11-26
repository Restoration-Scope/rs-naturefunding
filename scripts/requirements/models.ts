/**
 * The models the requirements pipeline calls, behind small interfaces so tests run with fakes:
 * - a JSON model (cheap extractor, strong escalator): an OpenAI model through the Responses API with a
 *   strict JSON schema (the default), Claude through the Anthropic SDK with structured outputs, or a
 *   Workers AI model through the refresh job's llm.ts;
 * - Jev (TypeSafe System One) for narrow typed checks.
 * Every call goes through a Ledger that counts tokens and dollars and stops at the run's spend cap,
 * and through a content-hash cache keyed by model, prompt version and input.
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { llmFromEnv } from '../refresh/llm'

/** `cached_input_tokens` is the part of `input_tokens` served from the provider's prompt cache, billed lower. */
export type Usage = { input_tokens: number; output_tokens: number; cached_input_tokens?: number }

/**
 * US dollars per million tokens: input, output and, where the provider discounts it, cached input.
 * OpenAI from developers.openai.com/api/docs/pricing (standard tier, read 2026-11-17).
 */
export const PRICES: Record<string, { input: number; output: number; cached?: number }> = {
  'gpt-5.6-luna': { input: 0.2, output: 1.2, cached: 0.02 },
  'gpt-5.6-terra': { input: 2, output: 12, cached: 0.2 },
  'gpt-5.6-sol': { input: 4, output: 20, cached: 0.4 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
  '@cf/openai/gpt-oss-120b': { input: 0.35, output: 0.75 },
  'jev-latest': { input: 0.042, output: 0 },
}

/** Long prompts are billed on a higher card: Claude Haiku above 100K input tokens, GPT-5.6 above 272K. */
const LONG: Record<string, { over: number; input: number; output: number; cached?: number }> = {
  'claude-haiku-5-5': { over: 100_000, input: 0.5, output: 2.5 },
  'gpt-5.6-luna': { over: 272_000, input: 0.4, output: 1.8, cached: 0.04 },
  'gpt-5.6-terra': { over: 272_000, input: 4, output: 18, cached: 0.4 },
  'gpt-5.6-sol': { over: 272_000, input: 8, output: 30, cached: 0.8 },
}

export const costOf = (model: string, u: Usage) => {
  if (model.startsWith('cursor:')) return 0 // billed to the Cursor plan
  if (model.startsWith('ollama:')) return 0 // runs locally
  const long = LONG[model]
  const p = (long && u.input_tokens > long.over ? long : undefined) ?? PRICES[model] ?? { input: 10, output: 50 }
  const cached = Math.min(u.cached_input_tokens ?? 0, u.input_tokens)
  return ((u.input_tokens - cached) * p.input + cached * (p.cached ?? p.input) + u.output_tokens * p.output) / 1e6
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

type OpenAIResponse = {
  status: string
  incomplete_details?: { reason?: string } | null
  output: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[]
  usage: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } }
}

/** The zod schema as a strict JSON schema: every object closed, every key required, nulls for "not stated". */
export function strictSchema(schema: z.ZodType<unknown>) {
  const { $schema: _drop, ...json } = z.toJSONSchema(schema, { io: 'output' }) as Record<string, unknown>
  return json
}

/**
 * An OpenAI model through the Responses API, the answer constrained to the schema (strict structured
 * outputs). Plain fetch, like the TypeSafe client; retries 429 and 5xx with backoff.
 */
export function openaiModel(model: string, opts: { effort?: 'none' | 'low' | 'medium' | 'high'; maxTokens?: number } = {}, key = process.env.OPENAI_API_KEY): JsonModel | null {
  if (!key) return null
  return {
    name: model,
    async json(system, user, schema) {
      const body = JSON.stringify({
        model,
        instructions: system,
        input: user,
        max_output_tokens: opts.maxTokens ?? 32000,
        ...(opts.effort ? { reasoning: { effort: opts.effort } } : {}),
        text: { format: { type: 'json_schema', name: 'answer', schema: strictSchema(schema as z.ZodType<unknown>), strict: true } },
        store: false,
      })
      let r: OpenAIResponse
      for (let attempt = 0; ; attempt++) {
        const res = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body,
          signal: AbortSignal.timeout(600_000),
        })
        if ((res.status === 429 || res.status >= 500) && attempt < 5) {
          await Bun.sleep(Math.min(Number(res.headers.get('retry-after') ?? 2 ** attempt), 60) * 1000)
          continue
        }
        const text = await res.text()
        if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 300)}`)
        r = JSON.parse(text) as OpenAIResponse
        break
      }
      const usage: Usage = { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens, cached_input_tokens: r.usage.input_tokens_details?.cached_tokens ?? 0 }
      const parts = r.output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? [])
      const refusal = parts.find((c) => c.type === 'refusal')
      if (refusal) throw new SpentError(`${model} declined the request: ${(refusal.refusal ?? '').slice(0, 200)}`, usage)
      if (r.status === 'incomplete') throw new SpentError(`${model} stopped early (${r.incomplete_details?.reason ?? 'unknown'})`, usage)
      const text = parts.filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('')
      try {
        return { value: schema.parse(JSON.parse(text)), usage }
      } catch (e) {
        throw new SpentError(`${model} answered outside the schema: ${(e as Error).message.slice(0, 200)}`, usage)
      }
    },
  }
}

/**
 * A model through the signed-in Cursor CLI (`cursor-agent`), billed to the Cursor plan, not an API key:
 * `cursor:gpt-5.6-luna-high`. Read-only ask mode in an empty folder, so the agent has nothing to touch.
 * No structured outputs, so the JSON schema goes in the prompt and the answer is checked in code; up to
 * two retries on a malformed answer or a failed call.
 */
export function cursorModel(model: string, cwd = join(process.cwd(), '.cache', 'requirements', 'cursor-ws')): JsonModel {
  const name = `cursor:${model}`
  mkdirSync(cwd, { recursive: true })
  return {
    name,
    async json(system, user, schema) {
      const prompt = `${system}\n\n${user}\n\nAnswer with one JSON object only, no prose and no code fences, matching this JSON schema (null where the text doesn't say):\n${JSON.stringify(strictSchema(schema as z.ZodType<unknown>))}`
      const usage: Usage = { input_tokens: 0, output_tokens: 0 }
      let last = ''
      for (let attempt = 0; attempt < 3; attempt++) {
        const proc = Bun.spawn(['cursor-agent', '-p', '--model', model, '--output-format', 'json', '--mode', 'ask', '--trust'], { cwd, stdin: new Blob([prompt]), stdout: 'pipe', stderr: 'pipe' })
        const timer = setTimeout(() => proc.kill(), 900_000)
        const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
        clearTimeout(timer)
        await proc.exited
        let r: { is_error?: boolean; result?: string; usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } }
        try {
          r = JSON.parse(out)
        } catch {
          last = `cursor-agent exited ${proc.exitCode}: ${(err || out).slice(0, 300)}`
          await Bun.sleep(5000 * (attempt + 1))
          continue
        }
        usage.input_tokens += (r.usage?.inputTokens ?? 0) + (r.usage?.cacheReadTokens ?? 0) + (r.usage?.cacheWriteTokens ?? 0)
        usage.output_tokens += r.usage?.outputTokens ?? 0
        if (r.is_error) {
          last = `${name} error: ${String(r.result).slice(0, 300)}`
          continue
        }
        const text = String(r.result ?? '').trim()
        try {
          return { value: schema.parse(JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))), usage }
        } catch (e) {
          last = `${name} answered outside the schema: ${(e as Error).message.slice(0, 200)}`
        }
      }
      throw new SpentError(last, usage)
    },
  }
}

/** Strips a schema frame a small model echoes around its answer, at any depth: {"type":"object","properties":{…}} becomes {…}. */
export const unframe = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(unframe) : v && typeof v === 'object' ? ((o) => (o.type === 'object' && o.properties && typeof o.properties === 'object' ? unframe(o.properties) : Object.fromEntries(Object.entries(o).map(([k, x]) => [k, unframe(x)]))))(v as Record<string, unknown>) : v

/**
 * A local model through Ollama (`ollama:inkling-2-mini`), free to run: /api/chat with the JSON schema as
 * `format`. A model Ollama can't constrain (Inkling 2 Mini on 0.40.18: "structured output is unavailable")
 * gets the schema in the prompt instead, checked in code with two retries, as the Cursor route does.
 * The context is set wide (OLLAMA_NUM_CTX, default 65536) because Ollama otherwise cuts long pages
 * silently; OLLAMA_THINK sets the thinking level (the model's default when unset).
 */
export function ollamaModel(model: string, host = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434', numCtx = Number(process.env.OLLAMA_NUM_CTX ?? 65536), think = process.env.OLLAMA_THINK): JsonModel {
  const name = `ollama:${model}`
  let constrained = true
  const chat = async (system: string, user: string, format: unknown) => {
    const res = await fetch(`${host.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false, ...(format ? { format } : {}), ...(think ? { think } : {}), options: { num_ctx: numCtx, temperature: 0 }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(1_800_000),
    })
    const text = await res.text()
    if (!res.ok) return { error: `Ollama HTTP ${res.status}: ${text.slice(0, 300)}`, status: res.status }
    return { r: JSON.parse(text) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number; done_reason?: string } }
  }
  return {
    name,
    async json(system, user, schema) {
      const json = strictSchema(schema as z.ZodType<unknown>)
      const usage: Usage = { input_tokens: 0, output_tokens: 0 }
      let last = ''
      for (let attempt = 0; attempt < 3; attempt++) {
        const got = constrained ? await chat(system, user, json) : await chat(system, `${user}\n\nAnswer with one JSON object only, no prose and no code fences, matching this JSON schema (null where the text doesn't say):\n${JSON.stringify(json)}`, null)
        if ('error' in got) {
          if (constrained && got.status === 501 && /structured output/.test(got.error!)) {
            constrained = false
            attempt--
            continue
          }
          throw new Error(got.error)
        }
        const r = got.r
        usage.input_tokens += r.prompt_eval_count ?? 0
        usage.output_tokens += r.eval_count ?? 0
        if (r.done_reason === 'length') {
          last = `${name} ran out of context or output tokens`
          continue
        }
        const text = (r.message?.content ?? '').trim()
        try {
          let v = JSON.parse(constrained ? text : text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
          // A small model may echo the schema's frame around its answer: {"type":"object","properties":{…}}.
          if (!constrained) v = unframe(v)
          return { value: schema.parse(v), usage }
        } catch (e) {
          last = `${name} answered outside the schema: ${(e as Error).message.slice(0, 200)}; it began: ${text.slice(0, 300)}`
          if (constrained) break
        }
      }
      throw new SpentError(last, usage)
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
