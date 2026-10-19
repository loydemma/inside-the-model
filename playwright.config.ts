import { defineConfig } from '@playwright/test'

const baseURL = process.env.BASE_URL ?? 'http://localhost:4173'

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  projects: [
    {
      name: 'gpu',
      testIgnore: /fallback\.spec\.ts/,
      // Real GPU (WebGPU via Metal) so the 3D scenes don't fall back to slow software rendering.
      use: { baseURL, launchOptions: { args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--enable-gpu'] } },
    },
    {
      name: 'no-gpu',
      testMatch: /fallback\.spec\.ts/,
      use: { baseURL, launchOptions: { args: ['--disable-gpu'] } },
    },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : { command: 'npm run build && npm run preview', url: baseURL, reuseExistingServer: true, timeout: 120_000 },
})
