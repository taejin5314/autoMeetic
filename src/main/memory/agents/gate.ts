import type { GateContext, GateResult } from './types'

export async function checkDeepAskGate(_ctx: GateContext): Promise<GateResult> {
  // Stream 1 placeholder: always allow.
  // Stream 2 will replace the body with real BYOK / license / subscription logic.
  return { allowed: true }
}
