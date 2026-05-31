import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3000,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin'
    }
  },
  optimizeDeps: {
    exclude: ['ffmpeg-wasm']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'ffmpeg-worker': ['./src/worker/decoder.worker.js']
        }
      }
    }
  }
})
