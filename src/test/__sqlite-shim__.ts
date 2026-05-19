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

const _require = createRequire(import.meta.url)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const altBinary = path.resolve(
  __dirname,
  '../../node_modules/better-sqlite3/build/Release/better_sqlite3_node115.node'
)

// Load the module itself — may succeed (returns the constructor) or fail (wrong ABI)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = _require('better-sqlite3') as any

// Try to instantiate with the default binary
let defaultWorks = true
try {
  const db = new mod(':memory:')
  db.close()
} catch {
  defaultWorks = false
}

// Build a Database-like constructor that injects nativeBinding when needed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let DatabaseExport: any

if (defaultWorks) {
  DatabaseExport = mod
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  DatabaseExport = function Database(filename: string, opts: Record<string, any> = {}) {
    return new mod(filename, { ...opts, nativeBinding: altBinary })
  }
  // Copy static properties
  Object.assign(DatabaseExport, mod)
  Object.setPrototypeOf(DatabaseExport, Object.getPrototypeOf(mod))
  DatabaseExport.prototype = mod.prototype
}

export default DatabaseExport
