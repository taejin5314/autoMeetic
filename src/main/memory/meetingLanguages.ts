export interface TranscriptLanguageState {
  sourceLanguage: string
  targetLanguage: string
}

export function resolveMeetingLanguages(
  startLanguage: string,
  state: TranscriptLanguageState
): TranscriptLanguageState {
  return {
    sourceLanguage: state.sourceLanguage || startLanguage || 'auto',
    targetLanguage: state.targetLanguage || 'off',
  }
}
