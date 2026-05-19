import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import fs from 'node:fs'
import path, { resolve } from 'node:path'
import type { Plugin } from 'vite'

function serveExcalidrawFonts(): Plugin {
  return {
    name: 'serve-excalidraw-fonts',
    configureServer(server) {
      const prefix = '/node_modules/@excalidraw/excalidraw/dist/prod/fonts/'

      server.middlewares.use((req, res, next) => {
        const requestUrl = req.url?.split('?')[0] ?? ''
        if (!requestUrl.startsWith(prefix)) return next()

        const relativePath = requestUrl.slice(1)
        const absolutePath = path.resolve(__dirname, relativePath)
        if (!absolutePath.endsWith('.woff2') || !fs.existsSync(absolutePath)) return next()

        res.statusCode = 200
        res.setHeader('Content-Type', 'font/woff2')
        fs.createReadStream(absolutePath).pipe(res)
      })
    },
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          embeddingWorker: resolve(__dirname, 'src/main/memory/embeddingWorker.ts'),
        },
        output: {
          format: 'cjs',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
        output: {
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), serveExcalidrawFonts()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
})
