import { describe, expect, it } from 'vitest'
import {
  buildMindMapSystemPrompt,
  parseOperations,
} from '../main/whiteboard/mindmapPrompt'

describe('parseOperations', () => {
  it('returns [] for non-JSON content', () => {
    expect(parseOperations('not json')).toEqual([])
  })

  it('returns [] when operations field is missing', () => {
    expect(parseOperations('{"foo":"bar"}')).toEqual([])
  })

  it('parses valid add_branch and upgrade_root', () => {
    const raw = JSON.stringify({
      operations: [
        { type: 'add_branch', parentLabel: 'Meeting', label: 'Goals' },
        { type: 'upgrade_root', newLabel: 'Q4 Planning' },
      ],
    })
    const out = parseOperations(raw)
    expect(out).toHaveLength(2)
    expect(out[0].type).toBe('add_branch')
    expect(out[1].type).toBe('upgrade_root')
  })

  it('drops operations with unknown type', () => {
    const raw = JSON.stringify({
      operations: [
        { type: 'add_branch', parentLabel: 'A', label: 'B' },
        { type: 'remove_branch', label: 'Q' },
      ],
    })
    expect(parseOperations(raw)).toHaveLength(1)
  })

  it('drops add_branch with missing fields', () => {
    const raw = JSON.stringify({
      operations: [
        { type: 'add_branch', parentLabel: '', label: 'B' },
        { type: 'add_branch', parentLabel: 'A' },
        { type: 'add_branch', label: 'C' },
      ],
    })
    expect(parseOperations(raw)).toEqual([])
  })

  it('truncates to 5 operations', () => {
    const ops = Array.from({ length: 8 }, (_, i) => ({
      type: 'add_branch',
      parentLabel: 'Meeting',
      label: `B${i}`,
    }))
    const raw = JSON.stringify({ operations: ops })
    expect(parseOperations(raw)).toHaveLength(5)
  })
})

describe('buildMindMapSystemPrompt', () => {
  it('embeds the compact tree text and label language', () => {
    const out = buildMindMapSystemPrompt({
      treeText: 'ROOT: "Meeting"',
      labelLanguage: 'ko',
      glossaryBlock: '',
    })
    expect(out).toContain('Active label language: ko')
    expect(out).toContain('ROOT: "Meeting"')
  })

  it('includes glossary block when present', () => {
    const out = buildMindMapSystemPrompt({
      treeText: 'ROOT: "x"',
      labelLanguage: 'off',
      glossaryBlock: 'GLOSSARY: keep GPU verbatim',
    })
    expect(out).toContain('GLOSSARY: keep GPU verbatim')
  })
})
