export interface AsyncTranslator {
  translate(text: string): Promise<string>
}

/**
 * Calls the proxy's /api/translate endpoint which proxies to Anthropic claude-sonnet.
 * Translates English (or any language) → Korean by default.
 */
export class AnthropicTranslator implements AsyncTranslator {
  private readonly endpoint: string

  constructor(endpoint = '/api/translate') {
    this.endpoint = endpoint
  }

  async translate(text: string): Promise<string> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, targetLang: 'ko' }),
    })
    if (!res.ok) {
      throw new Error(`Translation API error: ${res.status} ${res.statusText}`)
    }
    const data = await res.json() as { translation: string }
    return data.translation
  }
}
