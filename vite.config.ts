import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: {
    proxy: {
      '/api/ws': {
        target: 'http://127.0.0.1:3211',
        ws: true,
        configure: (proxy) => {
          proxy.on('error', () => { /* suppress ECONNABORTED on page reload */ })
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
