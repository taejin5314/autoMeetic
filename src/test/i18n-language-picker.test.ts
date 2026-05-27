import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { I18nextProvider } from 'react-i18next'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { LanguagePicker } from '../renderer/i18n/LanguagePicker'

beforeAll(async () => {
  await i18n.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: { en: { common: {} } },
  })
})

describe('LanguagePicker', () => {
  it('renders 5 options (System + 4 languages)', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        I18nextProvider,
        { i18n },
        React.createElement(LanguagePicker)
      )
    )

    expect(html).toContain('<option value="system" selected="">System</option>')
    expect(html).toContain('<option value="en">English</option>')
    expect(html).toContain('<option value="ko">한국어</option>')
    expect(html).toContain('<option value="ja">日本語</option>')
    expect(html).toContain('<option value="zh">中文</option>')
  })
})
