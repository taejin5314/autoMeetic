import Database from 'better-sqlite3'
import { Worker } from 'node:worker_threads'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

async function testSqlite() {
  const tmpFile = path.join(os.tmpdir(), `memory-smoke-${Date.now()}.db`)
  const db = new Database(tmpFile)
  db.pragma('journal_mode = WAL')
  db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)')
  db.prepare('INSERT INTO t(v) VALUES (?)').run('hello')
  const row = db.prepare('SELECT v FROM t WHERE id = 1').get()
  db.close()
  fs.unlinkSync(tmpFile)
  fs.existsSync(tmpFile + '-shm') && fs.unlinkSync(tmpFile + '-shm')
  fs.existsSync(tmpFile + '-wal') && fs.unlinkSync(tmpFile + '-wal')
  if (row?.v !== 'hello') throw new Error('sqlite roundtrip failed')
  console.log('[smoke] sqlite OK')
}

async function testEmbeddingWorker() {
  return new Promise((resolve, reject) => {
    const workerSrc = `
      import { parentPort } from 'node:worker_threads'
      import { pipeline } from '@xenova/transformers'
      ;(async () => {
        try {
          const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { quantized: true })
          const out = await extractor(['query: hello'], { pooling: 'mean', normalize: true })
          parentPort.postMessage({ ok: true, dims: out.dims })
        } catch (err) {
          parentPort.postMessage({ ok: false, error: err.message })
        }
      })()
    `
    const workerFile = path.join(process.cwd(), `.embed-smoke-${Date.now()}.mjs`)
    fs.writeFileSync(workerFile, workerSrc)
    const worker = new Worker(workerFile, { execArgv: ['--experimental-specifier-resolution=node'] })
    const timeout = setTimeout(() => {
      worker.terminate()
      reject(new Error('embedding worker timed out (model download? network?)'))
    }, 180_000)
    worker.on('message', (m) => {
      clearTimeout(timeout)
      worker.terminate()
      fs.unlinkSync(workerFile)
      if (m.ok) {
        console.log('[smoke] embedding worker OK, dims=', m.dims)
        resolve()
      } else {
        reject(new Error('embedding worker failed: ' + m.error))
      }
    })
    worker.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
  })
}

await testSqlite()
await testEmbeddingWorker()
console.log('[smoke] all dependency smoke checks passed')
