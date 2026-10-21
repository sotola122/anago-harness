import { availableParallelism } from 'node:os'
import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

/** Owner-local assembled expected-output tests that do not use a recorded session as their input. */
const requestedWorkers = Number.parseInt(process.env.DSH_EXPECTED_MAX_WORKERS ?? '', 10)

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    execArgv: vitestExecArgv,
    setupFiles: ['./scripts/test-proxy-environment.ts'],
    include: [
      'apps/cli/tests/**/*.expected.e2e.ts',
    ],
    testTimeout: 120_000,
    hookTimeout: 30_000,
    // Each worker spawns real CLI children, so a hosted runner that shares its
    // cores with sibling gates needs a lower bound than a developer machine.
    maxWorkers: Number.isSafeInteger(requestedWorkers) && requestedWorkers > 0
      ? requestedWorkers
      : Math.min(5, availableParallelism()),
  },
})
