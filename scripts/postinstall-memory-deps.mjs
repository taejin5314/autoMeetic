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

const electronRebuild = path.join(process.cwd(), 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js')
const rebuild = run(process.execPath, [electronRebuild, '-f', '-w', 'better-sqlite3'])

if (rebuild.status === 0) {
  process.exit(0)
}

console.warn(
  '[postinstall] electron-rebuild failed for better-sqlite3; restoring the Node prebuild for tests.'
)

const betterSqliteDir = path.join(process.cwd(), 'node_modules', 'better-sqlite3')
const prebuildInstall = path.join(process.cwd(), 'node_modules', 'prebuild-install', 'bin.js')
const restore = run(process.execPath, [prebuildInstall, '--verbose'], { cwd: betterSqliteDir })

if (restore.status !== 0) {
  console.warn(
    '[postinstall] failed to restore better-sqlite3 Node prebuild; install will continue, but memory smoke checks may fail.'
  )
}
