const TRANSLATION_MODEL = process.env.TRANSLATION_MODEL ?? 'gpt-4.1-mini'
const ANSWER_ASSIST_MODEL = process.env.ANSWER_ASSIST_MODEL ?? 'gpt-4.1-mini'
const OPENAI_TRANSLATION_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'

const LANGUAGE_NAME_BY_CODE = new Map([
  ['ko', 'Korean'],
  ['en', 'English'],
  ['ja', 'Japanese'],
  ['zh', 'Chinese'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
])

let globalVocabulary: string[] = []

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY not configured')
  return key
}

export async function translateText(
  text: string,
  targetLang: string
): Promise<{ translation: string }> {
  const apiKey = getApiKey()
  const targetLanguage = LANGUAGE_NAME_BY_CODE.get(targetLang) ?? targetLang

  const body = JSON.stringify({
    model: TRANSLATION_MODEL,
    max_tokens: Math.min(Math.max(Math.ceil(text.length * 1.8), 96), 512),
    messages: [
      {
        role: 'system',
        content:
          'You are a precise translation engine. Return only translated text with no quotes, labels, or explanations.',
      },
      {
        role: 'user',
        content: `Translate the following text to ${targetLanguage}. Return ONLY the translation. Do not explain, quote, identify languages, or add a preamble:\n\n${text}`,
      },
    ],
  })

  let response: Response | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(OPENAI_TRANSLATION_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    })
    if (response.status === 429 && attempt < 2) {
      const waitMs = Math.min(
        Math.max(parseFloat(response.headers.get('retry-after') || '3') * 1000, 1000),
        10000
      )
      await new Promise((r) => setTimeout(r, waitMs))
      continue
    }
    break
  }

  if (!response || !response.ok) {
    const payload = await response?.json().catch(() => ({}))
    const message = (payload as Record<string, unknown>)?.error
    throw new Error(
      message ? `OpenAI translation error: ${String(message)}` : 'OpenAI translation failed'
    )
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  const translation = payload?.choices?.[0]?.message?.content?.trim() ?? ''
  if (!translation) throw new Error('OpenAI translation returned empty text')

  return { translation }
}

export function updateVocabulary(keywords: string[]): { count: number } {
  globalVocabulary = keywords.filter((k) => typeof k === 'string' && k.length >= 3)
  return { count: globalVocabulary.length }
}

export function getVocabulary(): string[] {
  return globalVocabulary
}

export async function startAnswerAssist(
  transcript: string,
  lang: string,
  sendEvent: (event: unknown) => void
): Promise<void> {
  const apiKey = getApiKey()
  const langName = LANGUAGE_NAME_BY_CODE.get(lang) ?? lang

  const systemPrompt = `You are a real-time meeting answer coach. The user is in a live meeting and needs help responding to what is being discussed.

Your job:
1. Read the transcript and identify the most recent topic, question, or point that the user might need to respond to.
2. If you need factual information to answer well, use web_search_preview to look it up.
3. Write a concise response (3-5 sentences) in ${langName} that the user can speak aloud naturally.
4. Then write "---" on its own line.
5. Then write the Korean translation of your response.

Rules:
- Be concise and direct — this is for speaking aloud, not reading.
- Use a natural conversational tone appropriate for a meeting.
- Do NOT include any labels like "English:" or "Korean:" — just the text.
- Always provide a response.`

  const requestBody = {
    model: ANSWER_ASSIST_MODEL,
    tools: [{ type: 'web_search_preview' }],
    input: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Meeting transcript (most recent 3 minutes):\n\n${transcript.trim()}`,
      },
    ],
    stream: true,
  }

  let response: Response | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })
    if (response!.status === 429 && attempt < 2) {
      const waitMs = Math.min(
        Math.max(parseFloat(response!.headers.get('retry-after') || '3') * 1000, 1000),
        10000
      )
      await new Promise((r) => setTimeout(r, waitMs))
      continue
    }
    break
  }

  if (!response || !response.ok) {
    const errBody = await response?.json().catch(() => ({}))
    const message =
      (errBody as Record<string, Record<string, string>>)?.error?.message ??
      `OpenAI API error: ${response?.status}`
    sendEvent({ type: 'error', message })
    return
  }

  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullText = ''
  let sentSection = false
  let searchSent = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const json = line.slice(6).trim()
      if (!json || json === '[DONE]') continue

      let event: Record<string, unknown>
      try {
        event = JSON.parse(json) as Record<string, unknown>
      } catch {
        continue
      }

      if (event.type === 'response.web_search_call.in_progress' && !searchSent) {
        searchSent = true
        sendEvent({ type: 'searching', query: 'searching...' })
      }

      if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
        fullText += event.delta

        if (fullText.includes('[NO_QUESTION]')) {
          sendEvent({ type: 'no_question' })
          return
        }

        if (!sentSection && fullText.includes('\n---\n')) {
          sentSection = true
          sendEvent({ type: 'section', name: 'ko' })
          fullText = fullText.slice(fullText.indexOf('\n---\n') + 5)
          continue
        }

        if (!sentSection && fullText.trimEnd().endsWith('---')) continue

        sendEvent({ type: 'delta', content: event.delta })
      }

      if (event.type === 'response.completed') {
        const respOutput = (event.response as Record<string, unknown[]>)?.output
        const outputText =
          ((respOutput as Array<{ content: Array<{ text: string }> }>)?.[0]?.content?.[0]
            ?.text as string) ?? fullText
        const parts = outputText.split(/\n---\n/)
        sendEvent({
          type: 'done',
          answer: (parts[0] ?? '').trim(),
          answer_ko: (parts[1] ?? '').trim(),
        })
        return
      }
    }
  }

  const parts = fullText.split(/\n---\n/)
  sendEvent({
    type: 'done',
    answer: (parts[0] ?? '').trim(),
    answer_ko: (parts[1] ?? '').trim(),
  })
}
