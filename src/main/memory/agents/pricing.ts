interface Price {
  inputPer1M: number
  outputPer1M: number
}

// Approximate OpenAI pricing. Update this table when OpenAI changes model prices.
const PRICING: Record<string, Price> = {
  'gpt-4o': { inputPer1M: 5.0, outputPer1M: 15.0 },
  'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.6 },
  'gpt-4o-2024-08-06': { inputPer1M: 5.0, outputPer1M: 15.0 },
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? PRICING['gpt-4o']
  return (inputTokens / 1_000_000) * p.inputPer1M + (outputTokens / 1_000_000) * p.outputPer1M
}
