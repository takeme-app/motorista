import path from 'path';
import dotenv from 'dotenv';
import { defineConfig, devices } from '@playwright/test';

// Credenciais E2E: `.env` na raiz deste repositório.
dotenv.config({ path: path.join(__dirname, '.env') });

/** Porta própria evita colisão com cliente (8081) / motorista (8083); admin manual usa 8090. */
const e2ePort = process.env.PLAYWRIGHT_PORT ?? '9323';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${e2ePort}`;
const storageStatePath = path.join(__dirname, 'e2e/.auth/admin.json');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  projects: [
    { name: 'setup', testMatch: '**/auth.setup.ts' },
    {
      name: 'chromium',
      dependencies: ['setup'],
      testIgnore: '**/auth.setup.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL,
        trace: 'on-first-retry',
        storageState: storageStatePath,
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_WEBSERVER === '1'
    ? undefined
    : {
        command: `npx expo start --web --port ${e2ePort}`,
        cwd: __dirname,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
