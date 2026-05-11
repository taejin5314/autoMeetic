#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { WebSocket } from 'ws'

function parseArgs(argv) {
  const args = {}
  for (const item of argv) {
    const eq = item.indexOf('=')
    if (item.startsWith('--') && eq !== -1) args[item.slice(2, eq)] = item.slice(eq + 1)
    else if (item.startsWith('--')) args[item.slice(2)] = true
  }
  return args
}

function chunkTranscriptAtPunctuation(text) {
  const chunks = text
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter(Boolean)
  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function connectWs(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => {
    ws.once('open', resolve)
    ws.once('error', reject)
  })
  return ws
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const transcriptPath = args.transcript
  const outDir = args.out
  const wsBase = args.wsBase ?? 'ws://127.0.0.1:3211/api/ws/whiteboard'
  const chunkIntervalMs = Number(args['chunk-interval-ms'] ?? 500)

  if (!transcriptPath || !outDir) {
    console.error(
      'Usage: node scripts/simulate-whiteboard-agent.js --transcript=<path> --out=<dir> [--wsBase=ws://127.0.0.1:3211/api/ws/whiteboard] [--chunk-interval-ms=500]'
    )
    process.exitCode = 1
    return
  }

  await mkdir(outDir, { recursive: true })
  await mkdir(path.join(outDir, 'screenshots'), { recursive: true })

  const transcript = await readFile(path.resolve(transcriptPath), 'utf8')
  const chunks = chunkTranscriptAtPunctuation(transcript)

  const promptPath = path.resolve('src/main/whiteboard/prompt.ts')
  const promptText = await readFile(promptPath, 'utf8')
  const promptHash = createHash('sha256').update(promptText).digest('hex')

  await writeFile(path.join(outDir, 'prompt.txt'), promptText)
  await writeFile(path.join(outDir, 'chunks.json'), `${JSON.stringify(chunks, null, 2)}\n`)

  const ws = await connectWs(wsBase)
  const trajectory = []
  let elements = []

  const record = (event) => {
    trajectory.push({ ...event, timestamp: new Date().toISOString() })
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString())
      record({ type: 'websocket', message: msg })
      if (msg.type === 'whiteboard:update' && Array.isArray(msg.elements)) {
        elements = msg.elements
      }
    } catch {
      // ignore malformed websocket payload
    }
  })

  record({
    type: 'run:start',
    transcriptPath: path.resolve(transcriptPath),
    outDir,
    chunks: chunks.length,
    promptHash,
  })

  for (const [index, chunk] of chunks.entries()) {
    record({ type: 'transcript:chunk', index, text: chunk })
    ws.send(JSON.stringify({ type: 'whiteboard:agent-run', transcript: chunk }))
    await sleep(chunkIntervalMs)
  }

  await sleep(1500)
  ws.close()

  await writeFile(
    path.join(outDir, 'trajectory.jsonl'),
    `${trajectory.map((item) => JSON.stringify(item)).join('\n')}\n`
  )
  await writeFile(
    path.join(outDir, 'final-elements.json'),
    `${JSON.stringify(elements, null, 2)}\n`
  )

  record({ type: 'run:end', elements: elements.length, screenshots: 0 })

  console.log(
    `status: ok\nout: ${outDir}\nchunks: ${chunks.length}\nfinalElements: ${elements.length}\npromptHash: ${promptHash}`
  )
}

main().catch((error) => {
  console.error('simulation failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
