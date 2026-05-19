import { describe, expect, it } from 'vitest'
import packageJson from '../../package.json' with { type: 'json' }

describe('native dependency script routing', () => {
  it('prepares better-sqlite3 for Node before Node-based memory tests', () => {
    expect(packageJson.scripts.test).toContain('prepare-native-deps.mjs node')
    expect(packageJson.scripts['smoke:memory-deps']).toContain('prepare-native-deps.mjs node')
  })

  it('prepares better-sqlite3 for Electron before Electron dev and builds', () => {
    for (const script of [
      'dev:electron',
      'build:electron',
      'preview:electron',
      'build:win',
      'build:mac',
    ] as const) {
      expect(packageJson.scripts[script]).toContain('prepare-native-deps.mjs electron')
    }
  })
})
