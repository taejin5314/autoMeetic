import { parentPort } from 'node:worker_threads'

if (!parentPort) {
  throw new Error('embeddingWorker must be spawned as a worker_thread')
}

type Extractor = (
  input: string[],
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array; dims: number[] }>

let extractor: Extractor | null = null

async function ensure(): Promise<Extractor> {
  if (extractor) return extractor
  const { pipeline } = await import('@xenova/transformers')
  const cacheDir = process.env.MEMORY_EMBEDDING_CACHE_DIR
  const fn = (await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    quantized: true,
    ...(cacheDir ? { cache_dir: cacheDir } : {}),
  })) as unknown as Extractor
  extractor = fn
  return fn
}

parentPort.on('message', async (msg: { id: number; texts: string[] }) => {
  try {
    const fn = await ensure()
    const out = await fn(msg.texts, { pooling: 'mean', normalize: true })
    const dims = out.dims[1] ?? out.data.length / msg.texts.length
    const vectors: Float32Array[] = []
    for (let i = 0; i < msg.texts.length; i++) {
      vectors.push(new Float32Array(out.data.buffer, out.data.byteOffset + i * dims * 4, dims).slice())
    }
    parentPort!.postMessage({ id: msg.id, vectors })
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) })
  }
})
