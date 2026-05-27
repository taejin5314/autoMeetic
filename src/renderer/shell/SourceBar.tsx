import { useTranslation } from 'react-i18next'
import { Waveform } from '../overlay/Waveform'

interface SourceBarProps {
  running: boolean
  analyser: AnalyserNode | null
  error: string | null
  resetConfirming: boolean
  resetSession: () => void
  transcriptCount: number
  sourceWordCount: number
}

export function SourceBar({
  running,
  analyser,
  error,
  resetConfirming,
  resetSession,
  transcriptCount,
  sourceWordCount,
}: SourceBarProps) {
  const { t } = useTranslation()

  return (
    <div className="v4p-sourcebar">
      <div className={`v4p-source-cell ${running ? 'on' : ''}`}>
        <svg
          className="v4p-source-icon"
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2 4v3h2l2.5 2V2L4 4H2z" />
          <path d="M8 3.5c.7.7 1 1.3 1 2s-.3 1.3-1 2" />
        </svg>
        <span className="v4p-source-name">{t('sourceBar.system')}</span>
        <span className="v4p-source-app">{t('sourceBar.systemDetail')}</span>
        <div className="v4p-source-wave" aria-hidden="true">
          <Waveform analyser={analyser} active={running} />
        </div>
      </div>
      <div className="v4p-source-cell v4p-source-cell-mic">
        <svg
          className="v4p-source-icon"
          width="11"
          height="11"
          viewBox="0 0 11 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        >
          <rect x="4" y="1.5" width="3" height="5.5" rx="1.5" />
          <path d="M2.5 5.5a3 3 0 006 0M5.5 8.5V10" />
        </svg>
        <span className="v4p-source-name">{t('sourceBar.mic')}</span>
        <span className="v4p-source-app">{t('sourceBar.disabled')}</span>
      </div>
      <div className="v4p-source-cell v4p-source-cell-meta">
        {error && <span className="v4p-source-error">{error}</span>}
        <button
          type="button"
          className={`v4p-resetbtn ${resetConfirming ? 'confirming' : ''}`}
          onClick={resetSession}
          title={t('sourceBar.resetTitle')}
        >
          {resetConfirming ? t('sourceBar.confirmReset') : t('sourceBar.reset')}
        </button>
        <span className="v4p-source-dot">·</span>
        <span className="amw-mono v4p-meta-num">{transcriptCount}</span>
        <span className="v4p-meta-lbl">{t('sourceBar.captions')}</span>
        <span className="v4p-source-dot">·</span>
        <span className="amw-mono v4p-meta-num">{sourceWordCount}</span>
        <span className="v4p-meta-lbl">{t('sourceBar.words')}</span>
      </div>
    </div>
  )
}
