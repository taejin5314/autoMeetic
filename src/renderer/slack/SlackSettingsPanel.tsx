import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface SlackSettingsPanelProps {
  open: boolean
  onClose(): void
}

export function SlackSettingsPanel({ open, onClose }: SlackSettingsPanelProps) {
  const { t } = useTranslation()
  const [appToken, setAppToken] = useState('')
  const [botToken, setBotToken] = useState('')
  const [memberId, setMemberId] = useState('')
  const [hasTokens, setHasTokens] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const api = window.electronAPI?.slack

  useEffect(() => {
    if (!open || !api) return
    let active = true
    void api.loadStatus().then((status) => {
      if (!active) return
      setHasTokens(status.hasTokens)
      setMemberId(status.memberId ?? '')
    })
    return () => {
      active = false
    }
  }, [api, open])

  if (!open) return null

  const test = async () => {
    if (!api) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.test(botToken)
      setMessage(
        result.ok
          ? t('slack.settings.testSuccess', { team: result.team ?? '-' })
          : t('slack.settings.testFailed', { error: result.error ?? 'unknown' })
      )
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!api) return
    setBusy(true)
    setMessage(null)
    try {
      const result = await api.saveTokens({
        appToken: appToken.trim(),
        botToken: botToken.trim(),
        memberId: memberId.trim(),
      })
      if (!result.ok) {
        setMessage(t('slack.settings.saveFailed', { error: result.error ?? 'unknown' }))
        return
      }
      setHasTokens(true)
      setAppToken('')
      setBotToken('')
      setMessage(t('slack.settings.saved'))
    } finally {
      setBusy(false)
    }
  }

  const clear = async () => {
    if (!api) return
    setBusy(true)
    setMessage(null)
    try {
      await api.clearTokens()
      setHasTokens(false)
      setAppToken('')
      setBotToken('')
      setMemberId('')
      setMessage(t('slack.settings.cleared'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="slack-settings-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="slack-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label={t('slack.settings.dialogAria')}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="slack-settings-head">
          <div>
            <span>{hasTokens ? t('slack.settings.connected') : t('slack.settings.notConnected')}</span>
            <h2>{t('slack.settings.title')}</h2>
          </div>
          <button className="glossary-close" type="button" onClick={onClose} aria-label={t('slack.settings.closeAria')}>
            x
          </button>
        </header>

        <div className="slack-settings-fields">
          <label>
            <span>{t('slack.settings.appToken')}</span>
            <input
              type="password"
              value={appToken}
              onChange={(event) => setAppToken(event.target.value)}
              placeholder="xapp-..."
              autoComplete="off"
            />
          </label>
          <label>
            <span>{t('slack.settings.botToken')}</span>
            <input
              type="password"
              value={botToken}
              onChange={(event) => setBotToken(event.target.value)}
              placeholder="xoxb-..."
              autoComplete="off"
            />
          </label>
          <label>
            <span>{t('slack.settings.memberId')}</span>
            <input
              type="text"
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
              placeholder="U..."
              autoComplete="off"
            />
          </label>
        </div>

        {message ? <p className="slack-settings-message">{message}</p> : null}

        <footer className="slack-settings-actions">
          <button type="button" onClick={test} disabled={busy || !botToken.trim()}>
            {t('slack.settings.test')}
          </button>
          <button type="button" onClick={clear} disabled={busy || !hasTokens}>
            {t('slack.settings.clear')}
          </button>
          <button
            className="slack-settings-save"
            type="button"
            onClick={save}
            disabled={busy || !appToken.trim() || !botToken.trim() || !memberId.trim()}
          >
            {t('slack.settings.save')}
          </button>
        </footer>
      </section>
    </div>
  )
}
