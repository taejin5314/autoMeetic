import { describe, expect, it } from 'vitest'
import { buildAnswerAssistSystemPrompt } from '../main/proxyService'

describe('buildAnswerAssistSystemPrompt', () => {
  it('asks for both original and selected translation language when translation is enabled', () => {
    const prompt = buildAnswerAssistSystemPrompt('en', 'en')

    expect(prompt).toContain('in English')
    expect(prompt).toContain('Then write "---" on its own line.')
    expect(prompt).toContain('Then write the English translation of your response.')
    expect(prompt).not.toContain('Do not write a translation section.')
  })

  it('asks for only the original language when translation is off', () => {
    const prompt = buildAnswerAssistSystemPrompt('ko', 'off')

    expect(prompt).toContain('in Korean')
    expect(prompt).toContain('Do not write a translation section.')
    expect(prompt).not.toContain('Then write "---" on its own line.')
  })

  it('uses the transcript original language when source language is auto', () => {
    const prompt = buildAnswerAssistSystemPrompt('auto', 'en')

    expect(prompt).toContain("in the transcript's original language")
    expect(prompt).toContain('Then write the English translation of your response.')
  })
})
