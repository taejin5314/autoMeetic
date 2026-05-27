import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  detectSystemLanguage,
  readStoredPreference,
  writeStoredPreference,
} from './detectSystemLanguage'
import type { LanguagePreference, SupportedLanguage } from './types'

export function useAppLanguage(): {
  current: SupportedLanguage
  preference: LanguagePreference
  setPreference: (pref: LanguagePreference) => Promise<void>
} {
  const { i18n } = useTranslation()
  const [preference, setPreferenceState] = useState<LanguagePreference>(
    () => readStoredPreference() ?? 'system'
  )

  const setPreference = useCallback(
    async (pref: LanguagePreference) => {
      writeStoredPreference(pref)
      setPreferenceState(pref)
      const next = pref === 'system' ? await detectSystemLanguage() : pref
      await i18n.changeLanguage(next)
    },
    [i18n]
  )

  useEffect(() => {
    // No-op; i18n's languageChanged event triggers re-renders via context.
  }, [])

  return {
    current: i18n.language as SupportedLanguage,
    preference,
    setPreference,
  }
}
