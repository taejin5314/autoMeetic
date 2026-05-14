import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  root: 'src/renderer',
  plugins: [
    react(),
    {
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
    },
  ],
  server: {
    proxy: {
      '/api/ws': {
        target: 'http://127.0.0.1:3211',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', () => {
            /* suppress ECONNABORTED on page reload */
          })
          // Strip compression extension to prevent RSV1 frame mismatch through proxy
          proxy.on('proxyReqWs', (proxyReq: { removeHeader: (h: string) => void }) => {
            proxyReq.removeHeader('sec-websocket-extensions')
          })
        },
      },
      '/api': { target: 'http://127.0.0.1:3211' },
    },
  },
})
