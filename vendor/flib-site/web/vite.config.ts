import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { assetsInlineLimit, noInlinedFonts } from './src/build/asset-inline'

export default defineConfig({
  base: '/',
  plugins: [react(), noInlinedFonts()],
  build: {
    // CSP BFF `font-src 'self'`: шрифты никогда не инлайнятся как data: URI
    // (см. src/build/asset-inline.ts). Сторож noInlinedFonts() валит сборку,
    // если data:-шрифт всё же попал в CSS.
    assetsInlineLimit,
  },
  server: {
    // Dev-only: локальный фронт против живого BFF flib.club (субтитры/waveform/
    // STT-тикеты). В прод-сборку не попадает (vite build игнорирует server.*).
    proxy: {
      '/api': { target: 'https://flib.club', changeOrigin: true, ws: true },
    },
  },
})
