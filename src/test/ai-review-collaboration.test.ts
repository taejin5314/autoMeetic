import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const readText = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('ai review collaboration guardrails', () => {
  it('requires PR template risk, evidence, and triage sections', () => {
    const template = readText('.github/pull_request_template.md')

    expect(template).toContain('## Summary')
    expect(template).toContain('## Risk Areas')
    expect(template).toContain('## Test Evidence')
    expect(template).toContain('## AI Review Triage')
    expect(template).toContain('must-fix')
    expect(template).toContain('should-fix')
    expect(template).toContain('note')
    expect(template).toContain('## Deferred Follow-Ups')
  })

  it('requires AGENTS guidance for AI review triage and verification', () => {
    const agents = readText('AGENTS.md')

    expect(agents).toContain('Do not treat all AI review comments as correct.')
    expect(agents).toContain('Investigate every `must-fix` candidate.')
    expect(agents).toContain('Prefer adding a regression test before fixing a bug.')
    expect(agents).toContain('Explain any deferred `should-fix` comment in the PR.')
    expect(agents).toContain('Never mark work complete until verification commands have passed')
  })

  it('requires CodeRabbit focus on correctness, risk paths, and missing tests', () => {
    const codeRabbit = readText('.coderabbit.yaml')

    expect(codeRabbit).toContain('profile: assertive')
    expect(codeRabbit).toContain('request_changes_workflow: true')
    expect(codeRabbit).toContain('path_instructions:')
    expect(codeRabbit).toContain('src/renderer/**')
    expect(codeRabbit).toContain('src/main/whiteboard/**')
    expect(codeRabbit).toContain('src/main/ipc.ts')
    expect(codeRabbit).toContain('src/main/proxyService.ts')
    expect(codeRabbit).toContain('avoid style-only comments')
    expect(codeRabbit).toContain('ask for regression tests')
  })
})
