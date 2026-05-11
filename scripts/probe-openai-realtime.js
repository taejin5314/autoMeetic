#!/usr/bin/env node
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { WebSocket } from 'ws'

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const eq = arg.indexOf('=')
    return eq === -1 ? [arg.replace(/^--/, ''), true] : [arg.slice(2, eq), arg.slice(eq + 1)]
  })
)

const proxyWs = args.ws ?? 'ws://127.0.0.1:3211/api/ws/transcribe'
const pcmPath = args.pcm ?? process.argv[2] ?? 'probe.pcm'
const frameMs = Number(args.frameMs ?? 100)

function splitFrames(buffer, bytesPerFrame) {
  const frames = []
  for (let off = 0; off < buffer.length; off += bytesPerFrame) {
    frames.push(buffer.subarray(off, Math.min(off + bytesPerFrame, buffer.length)))
  }
  return frames
}

async function connectProxy(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  return ws
}

async function main() {
  if (!fs.existsSync(pcmPath)) {
    console.error(`PCM file not found: ${pcmPath}`)
    console.error('Usage: node scripts/probe-openai-realtime.js --pcm=probe.pcm [--ws=ws://127.0.0.1:3211/api/ws/transcribe]')
    process.exitCode = 1
    return
  }

  const ws = await connectProxy(proxyWs)
  const sessionId = randomUUID()
  const pcm = fs.readFileSync(pcmPath)
  const frameBytes = Math.floor(24000 * 2 * (frameMs / 1000))
  const frames = splitFrames(pcm, frameBytes)

  let ready = false
  let partialCount = 0
  let committedCount = 0

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      if (msg.type === 'ready') {
        ready = true
      }
      if (msg.type === 'partial') {
        partialCount += 1
      }
      if (msg.type === 'committed') {
        committedCount += 1
        console.log(`[committed] ${String(msg.text ?? '').slice(0, 120)}`)
      }
      if (msg.type === 'error') {
        console.error('[proxy error]', msg.message)
      }
    } catch {
      // ignore malformed messages
    }
  })

  ws.send(JSON.stringify({ type: 'audio:start', sessionId }))

  const waitDeadline = Date.now() + 10_000
  while (!ready && Date.now() < waitDeadline) {
    await sleep(100)
  }

  if (!ready) {
    console.error('Proxy did not become ready in time')
    ws.close()
    process.exitCode = 1
    return
  }

  console.log(`streaming ${frames.length} frames (${pcm.length} bytes)`) 
  for (const frame of frames) {
    ws.send(
      JSON.stringify({
        type: 'audio',
        sessionId,
        data: frame.toString('base64'),
      })
    )
    await sleep(frameMs)
  }

  ws.send(JSON.stringify({ type: 'stop' }))
  await sleep(3000)

  console.log(`result: partial=${partialCount}, committed=${committedCount}`)
  ws.close()
}

main().catch((error) => {
  console.error('probe failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
