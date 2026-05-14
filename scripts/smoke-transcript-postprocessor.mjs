import 'dotenv/config'

const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  console.error('OPENAI_API_KEY is not configured')
  process.exit(1)
}

const model = process.env.STT_POSTPROCESS_MODEL ?? 'gpt-4.1-mini'
const sample = `
we should ship the beta next friday can you prepare the rollout checklist
yeah i can draft it today and send it to sarah
great please make sure the customer migration risk is called out
`

const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'You clean rough live meeting transcripts.',
          'Return JSON only: {"turns":[{"speakerId":"speaker_a","speakerLabel":"Speaker A","text":"..."}]}.',
          'Do not translate, summarize, add facts, add commitments, or remove meaningful content.',
          'Fix punctuation, capitalization, sentence boundaries, and obvious filler only when meaning is preserved.',
          'Use speaker_a, speaker_b, speaker_c, or unknown.',
          'Use Speaker A, Speaker B, Speaker C, or Unknown.',
          'Split into speaker turns, not individual sentences.',
          'Keep the same speaker when uncertain.',
        ].join(' '),
      },
      { role: 'user', content: `Rough transcript batch:\n\n${sample}` },
    ],
  }),
})

if (!response.ok) {
  const text = await response.text()
  console.error(`OpenAI error ${response.status}: ${text}`)
  process.exit(1)
}

const payload = await response.json()
const content = payload.choices?.[0]?.message?.content ?? ''
console.log(content)

const parsed = JSON.parse(
  String(content)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
)
if (!Array.isArray(parsed.turns)) {
  console.error('Expected parsed.turns to be an array')
  process.exit(1)
}
if (parsed.turns.length === 0) {
  console.error('Expected at least one processed turn')
  process.exit(1)
}
for (const turn of parsed.turns) {
  if (typeof turn.text !== 'string' || turn.text.trim().length === 0) {
    console.error('Each turn must include non-empty text')
    process.exit(1)
  }
  if (typeof turn.speakerId !== 'string' || typeof turn.speakerLabel !== 'string') {
    console.error('Each turn must include speakerId and speakerLabel')
    process.exit(1)
  }
}
console.log(`Processed ${parsed.turns.length} speaker turn(s)`)
