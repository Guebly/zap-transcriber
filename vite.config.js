import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const crossOriginHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  // credentialless: habilita SharedArrayBuffer sem exigir CORP no HuggingFace CDN
  'Cross-Origin-Embedder-Policy': 'credentialless',
}

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
  },
  worker: {
    format: 'es',
  },
  // Impede que o Vite pré-bundle o transformers.js e quebre os caminhos do WASM
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  server: {
    headers: crossOriginHeaders,
  },
  preview: {
    headers: crossOriginHeaders,
  },
})
