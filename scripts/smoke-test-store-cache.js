#!/usr/bin/env node

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const eq = arg.indexOf('=')
    return eq === -1 ? [arg.replace(/^--/, ''), true] : [arg.slice(2, eq), arg.slice(eq + 1)]
  })
)

const mode = args.mode ?? 'both'
const model = args.model ?? 'gpt-5.5'
const turns = Number(args.turns ?? 4)
const baseURL = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1'
const apiKey = process.env.OPENAI_API_KEY
const accountId = process.env.OPENAI_ACCOUNT_ID

if (!apiKey) {
  console.error('OPENAI_API_KEY is required')
  process.exitCode = 1
}

const STATIC_INSTRUCTIONS = [
  'You are a test agent for prompt cache verification.',
  'Reply with exactly the single word OK and nothing else.',
  'Do not call tools. Do not explain.',
  '',
  'Background context (intentionally verbose to exceed cache minimum):',
  ...Array.from(
    { length: 60 },
    (_, i) =>
      `Paragraph ${i + 1}: This is filler content used to inflate the static instructions block above the cache threshold required for prompt caching to engage.`
  ),
].join('\n')

async function callResponses(body) {
  const res = await fetch(`${baseURL}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      ...(accountId ? { 'ChatGPT-Account-Id': accountId } : {}),
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() ?? ''

    for (const block of events) {
      const dataLine = block.split('\n').find((line) => line.startsWith('data: '))
      if (!dataLine) continue
      const json = dataLine.slice(6).trim()
      if (!json || json === '[DONE]') continue

      let payload
      try {
        payload = JSON.parse(json)
      } catch {
        continue
      }

      if (payload.type === 'response.completed') final = payload.response
    }
  }

  if (!final) throw new Error('Stream ended without response.completed')
  return final
}

function summarize(label, response) {
  const usage = response?.usage ?? {}
  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0
  const cached =
    usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
  const output = usage.output_tokens ?? 0
  const pct = input > 0 ? Math.round((cached / input) * 100) : 0
  return { label, input, cached, output, pct, id: response?.id }
}

async function runStoredMode() {
  console.log('\n=== mode: stored (store:true + previous_response_id) ===')
  const rows = []
  let previousId

  for (let i = 1; i <= turns; i += 1) {
    const body = {
      model,
      store: true,
      instructions: STATIC_INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: previousId
                ? `Turn ${i}: ack.`
                : `Turn ${i}: this is the first message. Reply OK.`,
            },
          ],
        },
      ],
      ...(previousId ? { previous_response_id: previousId } : {}),
    }

    const response = await callResponses(body)
    const row = summarize(`turn${i}`, response)
    rows.push(row)
    previousId = response.id

    console.log(
      `turn${i}: input=${row.input} cached=${row.cached} (${row.pct}%) output=${row.output} id=${row.id}`
    )
  }

  return rows
}

async function runStatelessMode() {
  console.log('\n=== mode: stateless (store:false, full history each turn) ===')
  const rows = []
  const history = []

  for (let i = 1; i <= turns; i += 1) {
    history.push({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: i === 1 ? `Turn ${i}: this is the first message. Reply OK.` : `Turn ${i}: ack.`,
        },
      ],
    })

    if (i > 1) {
      history.splice(history.length - 1, 0, {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'OK' }],
      })
    }

    const body = {
      model,
      store: false,
      instructions: STATIC_INSTRUCTIONS,
      input: history,
    }

    const response = await callResponses(body)
    const row = summarize(`turn${i}`, response)
    rows.push(row)

    console.log(
      `turn${i}: input=${row.input} cached=${row.cached} (${row.pct}%) output=${row.output} id=${row.id}`
    )
  }

  return rows
}

async function main() {
  if (!apiKey) return

  console.log(`Using base ${baseURL}, model ${model}, turns ${turns}`)

  const results = {}
  if (mode === 'stored' || mode === 'both') {
    results.stored = await runStoredMode()
  }
  if (mode === 'stateless' || mode === 'both') {
    results.stateless = await runStatelessMode()
  }

  console.log('\n=== summary ===')
  for (const [label, rows] of Object.entries(results)) {
    const cachedSum = rows.reduce((acc, r) => acc + r.cached, 0)
    const inputSum = rows.reduce((acc, r) => acc + r.input, 0)
    const pct = inputSum > 0 ? Math.round((cachedSum / inputSum) * 100) : 0
    console.log(
      `${label.padEnd(10)} cached=${cachedSum}/${inputSum} (${pct}%) across ${rows.length} turns`
    )
  }
}

main().catch((error) => {
  console.error('smoke test failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
