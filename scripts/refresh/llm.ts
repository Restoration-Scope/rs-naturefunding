/**
 * One OpenAI-compatible chat client for the two models that re-read changed pages:
 * an extractor and a reviewer from a different model family.
 * - github (default in Actions): GitHub Models with the workflow's own GITHUB_TOKEN; no secret, free tier.
 * - cloudflare: Workers AI on the account in wrangler.jsonc, with CLOUDFLARE_AI_TOKEN.
 * Models can be overridden with LLM_EXTRACTOR and LLM_REVIEWER.
 *   bun scripts/refresh/llm.ts --models   lists the models the provider offers
 */
export type Llm = {
  provider: string
  extractor: string
  reviewer: string
  /** Page text beyond this is cut, to stay inside the provider's input limit. */
  maxChars: number
  chat(model: string, system: string, user: string): Promise<unknown>
}

type Provider = { baseUrl: string; key: string; extractor: string; reviewer: string; maxChars: number; catalog: string }

function provider(env: NodeJS.ProcessEnv): [string, Provider] | null {
  // The workflow passes unset repo variables as "", so empty means "pick by which token exists".
  const name = env.LLM_PROVIDER?.trim() || (env.CLOUDFLARE_AI_TOKEN ? 'cloudflare' : env.GITHUB_TOKEN ? 'github' : '')
  if (name === 'cloudflare' && env.CLOUDFLARE_AI_TOKEN && env.CLOUDFLARE_ACCOUNT_ID) {
    const base = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai`
    return [name, {
      baseUrl: `${base}/v1`, key: env.CLOUDFLARE_AI_TOKEN, catalog: `${base}/models/search?task=Text%20Generation&per_page=100`,
      extractor: '@cf/openai/gpt-oss-120b', reviewer: '@cf/meta/llama-4-scout-17b-16e-instruct', maxChars: 60_000,
    }]
  }
  if (name === 'github' && env.GITHUB_TOKEN) {
    return [name, {
      baseUrl: 'https://models.github.ai/inference', key: env.GITHUB_TOKEN, catalog: 'https://models.github.ai/catalog/models',
      extractor: 'openai/gpt-4.1', reviewer: 'meta/llama-4-maverick-17b-128e-instruct-fp8', maxChars: 16_000,
    }]
  }
  return null
}

/** The JSON object in a model's answer, with or without code fences around it. */
export function parseJsonAnswer(content: string): unknown {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end < start) throw new Error(`no JSON object in the answer: ${content.slice(0, 200)}`)
  return JSON.parse(content.slice(start, end + 1))
}

export function llmFromEnv(env = process.env): Llm | null {
  const found = provider(env)
  if (!found) return null
  const [name, p] = found

  async function post(body: object): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${p.key}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      })
      if (res.status !== 429 || attempt === 2) return res
      const wait = Math.min(Number(res.headers.get('retry-after') ?? 30), 90)
      await Bun.sleep(wait * 1000)
    }
  }

  return {
    provider: name,
    extractor: env.LLM_EXTRACTOR?.trim() || p.extractor,
    reviewer: env.LLM_REVIEWER?.trim() || p.reviewer,
    maxChars: p.maxChars,
    async chat(model, system, user) {
      const messages = [{ role: 'system', content: system }, { role: 'user', content: user }]
      let res = await post({ model, messages, temperature: 0, response_format: { type: 'json_object' } })
      if (res.status === 400 || res.status === 422) res = await post({ model, messages, temperature: 0 })
      const text = await res.text()
      if (!res.ok) throw new Error(`${name} ${model}: HTTP ${res.status} ${text.slice(0, 300)}`)
      const json = JSON.parse(text)
      const content = json.choices?.[0]?.message?.content ?? json.result?.response
      if (typeof content !== 'string') throw new Error(`${name} ${model}: no message in the answer`)
      return parseJsonAnswer(content)
    },
  }
}

if (import.meta.main && process.argv.includes('--models')) {
  const found = provider(process.env)
  if (!found) throw new Error('no LLM provider configured')
  const res = await fetch(found[1].catalog, { headers: { authorization: `Bearer ${found[1].key}` } })
  const body = await res.text()
  console.log(`HTTP ${res.status}`)
  try {
    const json = JSON.parse(body)
    const models: { id?: string; name?: string }[] = Array.isArray(json) ? json : json.result ?? []
    for (const m of models) console.log(m.id ?? m.name)
  } catch {
    console.log(body.slice(0, 500))
  }
}
