import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const root = process.cwd()

function readProjectFile(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('MemoryLibraryPanel scrolling layout', () => {
  test('keeps the full meeting detail body inside one scrollable region', () => {
    const meetingsTab = readProjectFile('src/renderer/library/MeetingsTab.tsx')
    const css = readProjectFile('src/renderer/App.css')

    expect(meetingsTab).toContain('className="memory-detail-scroll amw-scroll"')
    expect(meetingsTab).not.toContain('className="memory-transcript amw-scroll"')
    expect(css).toMatch(/\.memory-detail-scroll\s*{[^}]*min-height:\s*0;/s)
  })

  test('offers original, translated, and combined export choices', () => {
    const meetingsTab = readProjectFile('src/renderer/library/MeetingsTab.tsx')

    expect(meetingsTab).toContain('<option value="source">{t(\'meetings.exportOriginal\')}</option>')
    expect(meetingsTab).toContain(
      '<option value="translation">{t(\'meetings.exportTranslation\')}</option>'
    )
    expect(meetingsTab).toContain('<option value="both">{t(\'meetings.exportBoth\')}</option>')
    expect(meetingsTab).toMatch(
      /api\.exportMeeting\(\s*selectedMeeting\.meeting\.id,\s*'markdown',\s*exportLanguageRef\.current\s*\)/
    )
  })

  test('exports the latest selected language without waiting for a rerender', () => {
    const meetingsTab = readProjectFile('src/renderer/library/MeetingsTab.tsx')

    expect(meetingsTab).toContain('const exportLanguageRef = useRef<ExportLanguageMode>')
    expect(meetingsTab).toMatch(/exportLanguageRef\.current\s*=\s*nextLanguage/)
    expect(meetingsTab).toMatch(
      /api\.exportMeeting\(\s*selectedMeeting\.meeting\.id,\s*'markdown',\s*exportLanguageRef\.current\s*\)/
    )
  })
})
