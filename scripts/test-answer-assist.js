// scripts/test-answer-assist.js
//
// Smoke test: send a sample transcript to /api/answer-assist and print SSE events.
// Usage: node scripts/test-answer-assist.js
//
// Requires the proxy server running on localhost:3211

const PROXY_URL = `http://localhost:${process.env.PROXY_PORT || 3211}/api/answer-assist`

const sampleTranscript = `
So we've been discussing the migration from our monolithic architecture to microservices.
The main concern is how to handle data consistency across services.
I think we should use event sourcing for the order management system.
But what do you think about using saga pattern versus two-phase commit for distributed transactions?
`

async function main() {
  console.log('[test] POST', PROXY_URL)
  console.log('[test] Transcript:', sampleTranscript.trim().slice(0, 80), '...')
  console.log()

  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ transcript: sampleTranscript.trim(), lang: 'en' }),
  })

  if (!res.ok) {
    console.error('[test] HTTP error:', res.status, await res.text())
    process.exit(1)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const json = line.slice(6).trim()
      if (!json) continue
      try {
        const event = JSON.parse(json)
        console.log('[SSE]', event.type, event.type === 'delta' ? event.content : JSON.stringify(event))
      } catch {
        console.log('[SSE] raw:', json)
      }
    }
  }

  console.log('\n[test] Stream complete.')
}

main().catch((err) => {
  console.error('[test] Fatal:', err)
  process.exit(1)
})
