import { defineConfig } from 'vite'

export default defineConfig({
  // The three.js and tokenizer chunks load lazily; they are big by design.
  build: { target: 'es2022', chunkSizeWarningLimit: 2600 },
})
