import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = process.cwd()

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('MemoryLibraryPanel scrolling layout', () => {
  test('keeps the full meeting detail body inside one scrollable region', () => {
    const panel = readProjectFile('src/renderer/library/MemoryLibraryPanel.tsx')
    const css = readProjectFile('src/renderer/App.css')

    expect(panel).toContain('className="memory-detail-scroll amw-scroll"')
    expect(panel).not.toContain('className="memory-transcript amw-scroll"')
    expect(css).toMatch(/\.memory-detail-scroll\s*{[^}]*min-height:\s*0;/s)
  })

  test('offers original, translated, and combined export choices', () => {
    const panel = readProjectFile('src/renderer/library/MemoryLibraryPanel.tsx')

    expect(panel).toContain('<option value="source">Original</option>')
    expect(panel).toContain('<option value="translation">Translation</option>')
    expect(panel).toContain('<option value="both">Both</option>')
    expect(panel).toMatch(
      /api\.exportMeeting\(\s*selectedMeeting\.meeting\.id,\s*'markdown',\s*exportLanguageRef\.current\s*\)/
    )
  })

  test('exports the latest selected language without waiting for a rerender', () => {
    const panel = readProjectFile('src/renderer/library/MemoryLibraryPanel.tsx')

    expect(panel).toContain('const exportLanguageRef = useRef<ExportLanguageMode>')
    expect(panel).toMatch(/exportLanguageRef\.current\s*=\s*nextLanguage/)
    expect(panel).toMatch(
      /api\.exportMeeting\(\s*selectedMeeting\.meeting\.id,\s*'markdown',\s*exportLanguageRef\.current\s*\)/
    )
  })
})
