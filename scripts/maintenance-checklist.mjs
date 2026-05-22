import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BUILD_PATH_PATTERNS = [
  /^src\/main\//,
  /^src\/renderer\//,
  /^src\/preload\//,
  /^electron\.vite\.config\.ts$/,
  /^electron-builder\.yml$/,
  /^vite\.config\.ts$/,
  /^vitest\.config\.ts$/,
  /^tsconfig[^/]*\.json$/,
  /(^|\/)package\.json$/,
  /(^|\/)package-lock\.json$/,
]

const HIGH_RISK_PATTERNS = [
  {
    label: 'live feed sentence grouping/auto-scroll',
    check: 'Verify sentence boundaries, incremental grouping, and auto-scroll behavior with streaming updates.',
    patterns: [/live[-/]?feed/i, /sentence[-/]?group/i, /auto[-/]?scroll/i, /transcript/i],
  },
  {
    label: 'translation language routing',
    check: 'Confirm source and target language selection stays correct across translation paths.',
    patterns: [/translation/i, /translate/i, /language[-/]?routing/i, /source[-/]?language/i, /target[-/]?language/i],
  },
  {
    label: 'answer assist prompt context',
    check: 'Review prompt inputs so answer assist keeps the intended transcript, memory, and user context.',
    patterns: [/answer[-/]?assist/i, /prompt[-/]?context/i],
  },
  {
    label: 'whiteboard layout/Excalidraw conversion',
    check: 'Inspect compact layouts and Excalidraw conversion output for readable diagrams.',
    patterns: [/whiteboard/i, /excalidraw/i],
  },
  {
    label: 'theme rendering',
    check: 'Check dark and light theme rendering for preserved state and readable contrast.',
    patterns: [/theme/i, /dark[-/]?light/i, /dark/i, /light/i],
  },
  {
    label: 'renderer/main IPC contracts',
    check: 'Validate renderer, preload, and main process IPC payloads stay compatible.',
    patterns: [/ipc/i, /^src\/preload\//i, /renderer[-/]?main/i],
  },
]

const REQUIRED_COMMANDS = ['npm run typecheck', 'npm run lint', 'npm test']

function normalizeFilePath(file) {
  return file.replaceAll('\\', '/')
}

function matchesAnyPattern(file, patterns) {
  return patterns.some((pattern) => pattern.test(file))
}

export function classifyChangedFiles(files) {
  const changedFiles = [...new Set(files.map(normalizeFilePath).filter(Boolean))]
  const buildFiles = changedFiles.filter((file) => matchesAnyPattern(file, BUILD_PATH_PATTERNS))
  const highRiskAreas = HIGH_RISK_PATTERNS.map(({ label, check, patterns }) => ({
    label,
    check,
    files: changedFiles.filter((file) => matchesAnyPattern(file, patterns)),
  })).filter((area) => area.files.length > 0)

  return {
    changedFiles,
    requiredCommands: REQUIRED_COMMANDS,
    buildRequired: buildFiles.length > 0,
    buildFiles,
    highRiskAreas,
  }
}

export function formatChecklist(classification) {
  const commands = classification.buildRequired
    ? [...classification.requiredCommands, 'npm run build']
    : classification.requiredCommands
  const lines = ['Maintenance verification checklist', '']

  lines.push('Changed files:')
  if (classification.changedFiles.length === 0) {
    lines.push('- No changed files detected by git diff --name-only HEAD')
  } else {
    lines.push(...classification.changedFiles.map((file) => `- ${file}`))
  }

  lines.push('', 'Required verification:')
  lines.push(...commands.map((command) => `- ${command}`))

  if (classification.buildRequired) {
    lines.push('', 'Build required because these paths changed:')
    lines.push(...classification.buildFiles.map((file) => `- ${file}`))
  }

  lines.push('', 'High-risk review focus:')
  if (classification.highRiskAreas.length === 0) {
    lines.push('- No high-risk path matches detected')
  } else {
    for (const area of classification.highRiskAreas) {
      lines.push(`- ${area.label}: ${area.check}`)
      lines.push(`  Matched files: ${area.files.join(', ')}`)
    }
  }

  lines.push(
    '',
    'Before editing, classify the task as cleanup, refactor, bug fix, or performance work.',
    'For performance work, capture before/after measurements under the same conditions.',
  )

  return `${lines.join('\n')}\n`
}

function getChangedFiles() {
  return execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
}

const currentFile = fileURLToPath(import.meta.url)
const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : ''

if (currentFile === invokedFile) {
  process.stdout.write(formatChecklist(classifyChangedFiles(getChangedFiles())))
}
