#!/usr/bin/env node
/**
 * autoMeetic verification script.
 *
 * Usage:
 *   npm run verify                  General check (typecheck + lint + vitest)
 *   npm run verify:phase <N>        Above + expected files for Phase N of active plan
 *
 * Exits 0 only when all checks pass. Designed to be the single source of
 * truth for "is the codebase in a clean state right now?" — any AI agent
 * marking a phase complete in HANDOFF.md MUST paste this output verbatim
 * and only mark ✅ when the VERDICT line shows ✅.
 *
 * Pure Node.js (no dependencies). Works on Windows + macOS + Linux.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const GREEN = '[32m'
const RED = '[31m'
const YELLOW = '[33m'
const RESET = '[0m'
const BOLD = '[1m'

const ok = (s) => `${GREEN}${s}${RESET}`
const bad = (s) => `${RED}${s}${RESET}`
const warn = (s) => `${YELLOW}${s}${RESET}`

function run(cmd, args) {
  const start = Date.now()
  const r = spawnSync(cmd, args, {
    encoding: 'utf-8',
    cwd: ROOT,
    shell: process.platform === 'win32',
  })
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    code: r.status ?? -1,
    durationMs: Date.now() - start,
  }
}

function runCheck(name, cmd, args, parser) {
  process.stdout.write(`  Running ${name}…\r`)
  const r = run(cmd, args)
  const parsed = parser(r)
  const icon = parsed.pass ? ok('✅') : bad('❌')
  const seconds = (r.durationMs / 1000).toFixed(1)
  console.log(`  ${icon} ${name} (${parsed.summary}, ${seconds}s)`)
  return { ...parsed, name, output: (r.stdout + r.stderr).trim() }
}

function checkTypecheck() {
  return runCheck('typecheck', 'npm', ['run', 'typecheck'], (r) => ({
    pass: r.code === 0,
    summary: r.code === 0 ? '0 errors' : 'failed',
  }))
}

function checkLint() {
  return runCheck('lint', 'npm', ['run', 'lint'], (r) => {
    const out = r.stdout + r.stderr
    const m = out.match(/(\d+)\s+problems?\s+\((\d+)\s+errors?/i)
    if (m) {
      const errors = parseInt(m[2], 10)
      return { pass: errors === 0, summary: `${errors} errors` }
    }
    return { pass: r.code === 0, summary: r.code === 0 ? '0 errors' : 'failed' }
  })
}

function checkVitest() {
  return runCheck('vitest', 'npx', ['vitest', 'run'], (r) => {
    const out = r.stdout + r.stderr
    const m = out.match(/Tests\s+(\d+)\s+passed\s+\((\d+)\)/i)
    if (m) {
      const passed = parseInt(m[1], 10)
      const total = parseInt(m[2], 10)
      return {
        pass: passed === total && r.code === 0,
        summary: `${passed} / ${total} passed`,
      }
    }
    if (out.includes('Test Files') && out.includes('failed')) {
      return { pass: false, summary: 'failed' }
    }
    return { pass: false, summary: 'unable to parse vitest output' }
  })
}

function gitLog(n) {
  const r = run('git', ['log', '--oneline', `-${n}`])
  return r.stdout.trim().split('\n').filter(Boolean)
}

function findActivePlan() {
  const handoffPath = join(ROOT, 'HANDOFF.md')
  if (!existsSync(handoffPath)) return null
  const content = readFileSync(handoffPath, 'utf-8')
  const lines = content.split('\n')
  let inActiveSection = false
  for (const line of lines) {
    if (line.includes('Next active stream')) {
      inActiveSection = true
      continue
    }
    if (inActiveSection && line.startsWith('## ')) break
    if (inActiveSection) {
      const m = line.match(/\*\*Plan:\*\*\s*`([^`]+)`/)
      if (m) return m[1]
    }
  }
  return null
}

function parsePhaseFiles(planPath, phaseNumber) {
  const fullPath = join(ROOT, planPath)
  if (!existsSync(fullPath)) return null
  const content = readFileSync(fullPath, 'utf-8')
  const phaseHeaderRe = new RegExp(`^## Phase ${phaseNumber}\\b`, 'm')
  const startMatch = phaseHeaderRe.exec(content)
  if (!startMatch) return null
  const afterStart = content.slice(startMatch.index + startMatch[0].length)
  const nextPhaseRe = new RegExp(`^## Phase ${phaseNumber + 1}\\b|^## Self-review|^## Open questions`, 'm')
  const endMatch = nextPhaseRe.exec(afterStart)
  const phaseBody = endMatch ? afterStart.slice(0, endMatch.index) : afterStart

  const fileRe = /`(src\/[^\s`]+\.(?:ts|tsx|js|jsx|mjs|css))`/g
  const seen = new Set()
  let m
  while ((m = fileRe.exec(phaseBody)) !== null) {
    seen.add(m[1])
  }
  return [...seen]
}

function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function main() {
  const args = process.argv.slice(2)
  let phaseNumber = null
  if (args[0] === '--phase' && args[1]) {
    phaseNumber = parseInt(args[1], 10)
  } else if (args[0] && /^\d+$/.test(args[0])) {
    phaseNumber = parseInt(args[0], 10)
  }
  if (phaseNumber !== null && !Number.isFinite(phaseNumber)) {
    console.error('Invalid phase number')
    process.exit(2)
  }

  console.log(`\n${BOLD}🔍 autoMeetic verification — ${nowStamp()}${RESET}`)

  let phaseContext = null
  if (phaseNumber !== null) {
    const planPath = findActivePlan()
    if (!planPath) {
      console.log(
        bad(`\n  ❌ Could not find active plan in HANDOFF.md "Next active stream" section.`)
      )
      console.log(`  Continuing with general checks only.`)
    } else {
      console.log(`\n  Plan: ${planPath}`)
      console.log(`  Verifying ${BOLD}Phase ${phaseNumber}${RESET}\n`)
      const expectedFiles = parsePhaseFiles(planPath, phaseNumber)
      if (expectedFiles && expectedFiles.length > 0) {
        console.log(`  Expected files (referenced in Phase ${phaseNumber} body):`)
        let allExist = true
        for (const f of expectedFiles) {
          const exists = existsSync(join(ROOT, f))
          const icon = exists ? ok('  ✅') : bad('  ❌ MISSING')
          console.log(`  ${icon} ${f}`)
          if (!exists) allExist = false
        }
        phaseContext = { phaseNumber, planPath, expectedFiles, allExist }
        console.log('')
      } else {
        console.log(
          warn(
            `  ⚠️  Could not extract expected files for Phase ${phaseNumber} from plan. Continuing with general checks only.\n`
          )
        )
        phaseContext = {
          phaseNumber,
          planPath,
          expectedFiles: [],
          allExist: true,
        }
      }
    }
  } else {
    console.log('')
  }

  console.log(`${BOLD}Checks:${RESET}`)
  const tc = checkTypecheck()
  const lt = checkLint()
  const vt = checkVitest()

  console.log(`\n${BOLD}Git context (last 5 commits):${RESET}`)
  for (const line of gitLog(5)) console.log(`  ${line}`)

  const allPass =
    tc.pass && lt.pass && vt.pass && (phaseContext?.allExist !== false)

  console.log('')
  if (allPass) {
    if (phaseContext) {
      console.log(ok(`${BOLD}VERDICT: ✅ Phase ${phaseContext.phaseNumber} verified${RESET}`))
    } else {
      console.log(ok(`${BOLD}VERDICT: ✅ Verified clean${RESET}`))
    }
  } else {
    const reasons = []
    if (!tc.pass) reasons.push('typecheck failed')
    if (!lt.pass) reasons.push('lint failed')
    if (!vt.pass) reasons.push('vitest failed')
    if (phaseContext && !phaseContext.allExist) reasons.push('expected files missing')
    console.log(
      bad(`${BOLD}VERDICT: ❌ NOT verified — ${reasons.join(', ')}${RESET}`)
    )
  }
  console.log('')

  process.exit(allPass ? 0 : 1)
}

main()
