import { defineConfig } from 'vitest/config'

export default defineConfig({
  // vmThreads makes one jsdom per worker while keeping each file isolated.
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], pool: 'vmThreads' },
})
