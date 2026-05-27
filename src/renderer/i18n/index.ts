import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import ko from './locales/ko.json'
import ja from './locales/ja.json'
import zh from './locales/zh.json'
import {
  detectSystemLanguage,
  readStoredPreference,
  resolveLanguagePreference,
} from './detectSystemLanguage'

export async function initI18n(): Promise<void> {
  const resolved = await resolveLanguagePreference({
    readStorage: () => readStoredPreference(),
    detectFn: detectSystemLanguage,
  })

  await i18n.use(initReactI18next).init({
    resources: {
      en: { common: en },
      ko: { common: ko },
      ja: { common: ja },
      zh: { common: zh },
    },
    lng: resolved,
    fallbackLng: 'en',
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
  })
}

export default i18n
