import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })
}

const strictElectronRebuild =
  process.env.AUTOMEETIC_STRICT_ELECTRON_REBUILD === '1' ||
  process.env.npm_config_runtime === 'electron' ||
  process.env.npm_lifecycle_event === 'build:win' ||
  process.env.npm_lifecycle_event === 'build:mac'

const prepareNativeDeps = path.join(process.cwd(), 'scripts', 'prepare-native-deps.mjs')
const target = strictElectronRebuild ? 'electron' : 'node'
const prepare = run(process.execPath, [prepareNativeDeps, target])

if (prepare.status !== 0 && strictElectronRebuild) {
  console.error('[postinstall] failed to prepare better-sqlite3 for Electron in strict mode.')
  process.exit(prepare.status ?? 1)
}

if (prepare.status !== 0) {
  console.warn(
    `[postinstall] failed to prepare better-sqlite3 for ${target}; install will continue, but memory checks may fail.`
  )
}
