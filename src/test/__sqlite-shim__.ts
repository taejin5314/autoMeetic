/**
 * Shim used by vitest to load better-sqlite3 with the correct native binding.
 *
 * When Electron is running locally, it locks the Electron-compiled binary at
 * build/Release/better_sqlite3.node. The Node-compatible binary is kept at
 * better_sqlite3_node115.node. This shim injects nativeBinding so vitest
 * tests can run without needing to overwrite the locked file.
 *
 * In CI, prepare-native-deps.mjs node installs the correct binary before
 * vitest runs, so the default Database constructor works fine there.
 */
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import type Database from 'better-sqlite3'

type DatabaseCtor = typeof Database

const _require = createRequire(import.meta.url)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const altBinary = path.resolve(
  __dirname,
  '../../node_modules/better-sqlite3/build/Release/better_sqlite3_node115.node'
)

const mod = _require('better-sqlite3') as DatabaseCtor

// Probe whether the default native binding works in this environment.
let defaultWorks = true
try {
  const db = new mod(':memory:')
  db.close()
} catch {
  defaultWorks = false
}

let DatabaseExport: DatabaseCtor

if (defaultWorks) {
  DatabaseExport = mod
} else {
  const Fallback = function (this: unknown, filename: string, opts: Record<string, unknown> = {}) {
    return new mod(filename, { ...opts, nativeBinding: altBinary } as Database.Options)
  } as unknown as DatabaseCtor
  Object.assign(Fallback, mod)
  Object.setPrototypeOf(Fallback, Object.getPrototypeOf(mod))
  Fallback.prototype = mod.prototype
  DatabaseExport = Fallback
}

export default DatabaseExport
