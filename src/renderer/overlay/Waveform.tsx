/**
 * Audio waveform visualizer.
 * Ported from autopreso/public/app.js Waveform component (MIT License).
 * https://github.com/kunchenguid/autopreso
 */
import { useEffect, useRef } from 'react'

interface WaveformProps {
  analyser: AnalyserNode | null
  active: boolean
}

export function Waveform({ analyser, active }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1

    let raf = 0
    let lastWidth = 0
    let lastHeight = 0

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const width = Math.max(1, Math.floor(rect.width))
      const height = Math.max(1, Math.floor(rect.height))
      if (width === lastWidth && height === lastHeight) return
      lastWidth = width
      lastHeight = height
      canvas.width = width * dpr
      canvas.height = height * dpr
    }

    let resizeObserver: ResizeObserver | undefined
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(canvas)
    }
    resize()

    if (!analyser || !active) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      return () => {
        resizeObserver?.disconnect()
      }
    }

    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.85
    const data = new Uint8Array(analyser.fftSize)

    const draw = () => {
      analyser.getByteTimeDomainData(data)
      const w = canvas.width
      const h = canvas.height
      ctx.clearRect(0, 0, w, h)

      const mid = h / 2
      const amplitude = mid * 0.85

      const gradient = ctx.createLinearGradient(0, 0, w, 0)
      gradient.addColorStop(0, 'rgba(56, 189, 248, 0)')
      gradient.addColorStop(0.15, 'rgba(56, 189, 248, 0.95)')
      gradient.addColorStop(0.5, 'rgba(168, 85, 247, 0.95)')
      gradient.addColorStop(0.85, 'rgba(56, 189, 248, 0.95)')
      gradient.addColorStop(1, 'rgba(56, 189, 248, 0)')

      ctx.shadowColor = 'rgba(56, 189, 248, 0.55)'
      ctx.shadowBlur = 22 * dpr
      ctx.lineWidth = 2.4 * dpr
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = gradient

      ctx.beginPath()
      const step = w / data.length
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        const x = i * step
        const y = mid + v * amplitude
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()

      raf = requestAnimationFrame(draw)
    }

    raf = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(raf)
      resizeObserver?.disconnect()
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [analyser, active])

  return <canvas ref={canvasRef} className="waveform-canvas" />
}
