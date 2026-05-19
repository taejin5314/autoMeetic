import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const target = process.argv[2]
if (target !== 'node' && target !== 'electron') {
  console.error('[native-deps] usage: node scripts/prepare-native-deps.mjs <node|electron>')
  process.exit(2)
}

const childEnv = { ...process.env }
delete childEnv.ELECTRON_RUN_AS_NODE

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    env: childEnv,
    stdio: 'inherit',
    shell: false,
    ...options,
  })
}

function runOrExit(cmd, args, options = {}) {
  const result = run(cmd, args, options)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const root = process.cwd()
const betterSqliteDir = path.join(root, 'node_modules', 'better-sqlite3')
const prebuildInstall = path.join(root, 'node_modules', 'prebuild-install', 'bin.js')

function packageVersion(packageName) {
  const packageJson = path.join(root, 'node_modules', packageName, 'package.json')
  return JSON.parse(fs.readFileSync(packageJson, 'utf8')).version
}

if (target === 'electron') {
  const electronVersion = packageVersion('electron')
  const prebuild = run(
    process.execPath,
    [prebuildInstall, '--runtime=electron', `--target=${electronVersion}`, '--verbose'],
    { cwd: betterSqliteDir }
  )

  if (prebuild.status === 0) {
    process.exit(0)
  }

  let buildRoot = root

  if (process.platform === 'win32') {
    buildRoot = path.join(os.tmpdir(), 'automeetic-electron-rebuild')
    fs.rmSync(buildRoot, { recursive: true, force: true })
    runOrExit('cmd.exe', ['/d', '/s', '/c', 'mklink', '/J', buildRoot, root])
  }

  childEnv.PWD = buildRoot
  const electronRebuild = path.join(buildRoot, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js')
  runOrExit(
    process.execPath,
    [
      electronRebuild,
      '-f',
      '-w',
      'better-sqlite3',
      '--module-dir',
      buildRoot,
    ],
    { cwd: buildRoot }
  )
  process.exit(0)
}

runOrExit(process.execPath, [prebuildInstall, '--verbose'], { cwd: betterSqliteDir })
