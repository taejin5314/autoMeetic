import { log } from '../telemetry/logger'
import type { AudioChunk, CaptureConfig } from './types'

type ChunkListener = (chunk: AudioChunk) => void

const TARGET_SAMPLE_RATE = 24000

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Resample Float32 audio from one sample rate to another using linear
 * interpolation. Ported from autopreso/public/app.js (MIT).
 *
 * The carry buffer holds leftover samples that couldn't produce a full
 * output sample yet — this avoids clicks/gaps at chunk boundaries.
 */
function resample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
  carry: Float32Array
): { samples: Float32Array; carry: Float32Array } {
  const merged = new Float32Array(carry.length + input.length)
  merged.set(carry)
  merged.set(input, carry.length)

  const ratio = fromRate / toRate
  const outputLength = Math.floor((merged.length - 1) / ratio)
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const sourceIndex = i * ratio
    const left = Math.floor(sourceIndex)
    const right = Math.min(left + 1, merged.length - 1)
    const weight = sourceIndex - left
    output[i] = merged[left] * (1 - weight) + merged[right] * weight
  }

  const consumed = Math.floor(outputLength * ratio)
  return { samples: output, carry: merged.slice(consumed) }
}

/**
 * Convert Float32 PCM samples (range -1..1) to Int16 little-endian base64.
 * Ported from autopreso/public/app.js (MIT).
 */
function pcm16ToBase64(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  const bytes = new Uint8Array(pcm.buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

export class SystemAudioCaptureService {
  private audioCtx: AudioContext | undefined
  private processorNode: ScriptProcessorNode | undefined
  private analyserNode: AnalyserNode | undefined
  private stream: MediaStream | undefined
  private readonly listeners = new Set<ChunkListener>()
  private resampleCarry = new Float32Array(0)

  constructor(_config: Partial<CaptureConfig> = {}) {
    // Config available for future use
    void _config
  }

  subscribe(listener: ChunkListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Get the AnalyserNode for waveform visualization (available after start). Ported from autopreso. */
  get analyser(): AnalyserNode | undefined {
    return this.analyserNode
  }

  /**
   * Prompt the user to share a screen/window/tab (e.g. Slack), then capture
   * its audio as PCM16 24 kHz mono chunks and emit them to subscribers.
   *
   * Ported from autopreso's createAudioStreamer (MIT).
   * Key difference from previous implementation: we let the browser use its
   * native sample rate (usually 48 kHz) and resample in software to 24 kHz.
   * Browsers often silently ignore AudioContext({ sampleRate: 24000 }), which
   * caused OpenAI to receive 48 kHz audio labeled as 24 kHz → no transcription.
   */
  async start(): Promise<void> {
    if (this.audioCtx) return

    log('info', 'capture', 'requesting display media for system audio capture')

    // Use video:true for best cross-browser compatibility with tab/system audio.
    // We do not render the video anywhere; it only keeps the capture session alive.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      } as MediaTrackConstraints,
      video: true,
    })

    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error(
        'No audio track found. Select a browser tab/window and turn on "Share tab audio" (or "Share audio").'
      )
    }

    audioTracks[0].onended = () => {
      log('warn', 'capture', 'audio track ended by browser/user; stopping capture')
      this.stop()
    }

    this.stream = stream

    // Let the browser use its native sample rate — do NOT force 24kHz.
    // autopreso pattern: create default AudioContext, then resample to 24kHz.
    this.audioCtx = new AudioContext()
    const nativeRate = this.audioCtx.sampleRate
    const source = this.audioCtx.createMediaStreamSource(stream)

    this.resampleCarry = new Float32Array(0)

    // Analyser for waveform visualization (autopreso pattern)
    this.analyserNode = this.audioCtx.createAnalyser()
    this.analyserNode.fftSize = 1024
    this.analyserNode.smoothingTimeConstant = 0.85

    // ScriptProcessorNode gives raw float32 PCM; 4096 samples per buffer
    this.processorNode = this.audioCtx.createScriptProcessor(4096, 1, 1)
    this.processorNode.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0)

      // Resample from browser native rate to 24kHz (autopreso pattern)
      const resampled = resample(input, nativeRate, TARGET_SAMPLE_RATE, this.resampleCarry)
      this.resampleCarry = new Float32Array(resampled.carry)

      if (resampled.samples.length === 0) return

      const chunk: AudioChunk = {
        id: makeId('audio'),
        encoding: 'pcm16-base64',
        sampleRateHz: TARGET_SAMPLE_RATE,
        channels: 1,
        createdAtMs: Date.now(),
        payload: pcm16ToBase64(resampled.samples),
      }
      for (const listener of this.listeners) listener(chunk)
    }
    // Connect: source → analyser, source → processor → destination (autopreso pattern)
    source.connect(this.analyserNode)
    source.connect(this.processorNode)
    this.processorNode.connect(this.audioCtx.destination)

    log('info', 'capture', 'system audio capture started', {
      audioTrack: audioTracks[0].label,
      nativeSampleRate: nativeRate,
      targetSampleRate: TARGET_SAMPLE_RATE,
    })
  }

  stop(): void {
    if (this.processorNode) {
      this.processorNode.disconnect()
      this.processorNode = undefined
    }
    if (this.analyserNode) {
      this.analyserNode.disconnect()
      this.analyserNode = undefined
    }
    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {
        /* ignore */
      })
      this.audioCtx = undefined
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop())
      this.stream = undefined
    }
    this.resampleCarry = new Float32Array(0)
    log('info', 'capture', 'system audio capture stopped')
  }
}
