import { LANGUAGE_NATIVE_LABEL, SUPPORTED_LANGUAGES, type LanguagePreference } from './types'
import { useAppLanguage } from './useAppLanguage'

export function LanguagePicker() {
  const { preference, setPreference } = useAppLanguage()
  return (
    <select
      className="language-picker"
      value={preference}
      onChange={(e) => {
        void setPreference(e.target.value as LanguagePreference)
      }}
      aria-label="UI language"
      title="UI language"
    >
      <option value="system">System</option>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang} value={lang}>
          {LANGUAGE_NATIVE_LABEL[lang]}
        </option>
      ))}
    </select>
  )
}
