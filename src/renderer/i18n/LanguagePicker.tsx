import { useTranslation } from 'react-i18next'
import { LANGUAGE_NATIVE_LABEL, SUPPORTED_LANGUAGES, type LanguagePreference } from './types'
import { useAppLanguage } from './useAppLanguage'

export function LanguagePicker() {
  const { t } = useTranslation()
  const { preference, setPreference } = useAppLanguage()
  return (
    <select
      className="language-picker"
      value={preference}
      onChange={(e) => {
        void setPreference(e.target.value as LanguagePreference)
      }}
      aria-label={t('languagePicker.aria')}
      title={t('languagePicker.title')}
    >
      <option value="system">{t('languagePicker.system')}</option>
      {SUPPORTED_LANGUAGES.map((lang) => (
        <option key={lang} value={lang}>
          {LANGUAGE_NATIVE_LABEL[lang]}
        </option>
      ))}
    </select>
  )
}
