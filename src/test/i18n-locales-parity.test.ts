import { describe, expect, it } from 'vitest'
import en from '../renderer/i18n/locales/en.json'
import ko from '../renderer/i18n/locales/ko.json'
import ja from '../renderer/i18n/locales/ja.json'
import zh from '../renderer/i18n/locales/zh.json'

function leafKeys(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix]
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    out.push(...leafKeys(v, path))
  }
  return out
}

describe('locale parity', () => {
  const enKeys = new Set(leafKeys(en).filter((k) => !k.startsWith('_meta')))

  for (const [name, dict] of [
    ['ko', ko],
    ['ja', ja],
    ['zh', zh],
  ] as const) {
    it(`${name}.json has identical leaf-key set to en.json`, () => {
      const dictKeys = new Set(leafKeys(dict).filter((k) => !k.startsWith('_meta')))
      const missing = [...enKeys].filter((k) => !dictKeys.has(k))
      const extra = [...dictKeys].filter((k) => !enKeys.has(k))
      expect({ missing, extra }).toEqual({ missing: [], extra: [] })
    })
  }
})
