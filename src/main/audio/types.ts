export type AudioEncoding = 'pcm16-base64'

export interface AudioChunk {
  id: string
  encoding: AudioEncoding
  sampleRateHz: number
  channels: number
  createdAtMs: number
  payload: string
}

export interface CaptureConfig {
  sampleRateHz: number
  channels: number
  chunkIntervalMs: number
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = {
  sampleRateHz: 24000,
  channels: 1,
  chunkIntervalMs: 200,
}
