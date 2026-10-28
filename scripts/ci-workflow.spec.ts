import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

function evaluateRunsOn(selector: unknown, context: Record<string, unknown>): unknown {
  if (typeof selector !== 'string') throw new TypeError('Runner selector must be a string')
  return runInNewContext(selector.trim().slice(3, -2), context, { timeout: 1000 })
}

const root = resolve(import.meta.dirname, '..')
const runnerPrivatePnpmDestination = /^\$\{\{ runner\.temp \}\}\/setup-pnpm-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}$/
const nativeWindowsPnpmDestination = '${{ runner.temp }}/setup-pnpm-js-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}'

describe('CI workflow', () => {
  it('keeps at most eleven worker jobs active across PR workflows while Python runtime targets follow the SDK suite', () => {
    const ci = loadWorkflow('.github/workflows/ci.yml')
    const ciWindows = loadWorkflow('.github/workflows/ci-windows.yml')
    const ciPython = loadWorkflow('.github/workflows/ci-python.yml')
    const compatibility = workflowJob(ci, 'node-compat')
    const runtime = workflowJob(ciPython, 'python-runtime')
    if (!isRecord(ci.jobs)
      || !isRecord(ciWindows.jobs)
      || !isRecord(ciPython.jobs)
      || !isRecord(compatibility.strategy)
      || !isRecord(runtime.with)) {
      throw new TypeError('CI, CI Windows, and CI Python must define jobs, compatibility scheduling, and runtime inputs')
    }
    const compatibilityLimit = compatibility.strategy['max-parallel']
    const targets = runtime.with.targets
    if (typeof compatibilityLimit !== 'number' || typeof targets !== 'string') {
      throw new TypeError('CI requires a numeric compatibility limit and explicit runtime targets')
    }
    expect(Number.isInteger(compatibilityLimit)).toBe(true)
    expect(compatibilityLimit).toBeGreaterThan(0)
    expect(compatibility.strategy).toMatchObject({
      'fail-fast': false,
      matrix: { include: [{ node: '24.9' }, { node: 26 }] },
    })
    expect(workflowJob(ci, 'all-checks-passed').needs).toContain('node-compat')
    const ordinaryJobs = Object.entries(ci.jobs)
      .filter(([name]) => !['node-compat', 'all-checks-passed'].includes(name))
    for (const [name, job] of ordinaryJobs) {
      if (!isRecord(job)) throw new TypeError(`${name} must define a job`)
      expect(job).not.toHaveProperty('strategy')
      expect(job).not.toHaveProperty('uses')
    }
    // Python reports its own required verdict, so neither its jobs nor a
    // reusable workflow caller remain in the Linux or Windows workflow.
    expect(Object.keys(ci.jobs).filter(name => name.startsWith('python'))).toEqual([])
    expect(Object.keys(ciWindows.jobs)).not.toContain('python-runtime')

    const pythonSdk = workflowJob(ciPython, 'python-sdk')
    expect(pythonSdk).not.toHaveProperty('strategy')
    expect(pythonSdk).not.toHaveProperty('uses')
    expect(runtime.needs).toBe('python-sdk')
    expect(runtime.strategy).toBeUndefined()
    expect(runtime.with).toMatchObject({ targets: 'node24-linux-x64,node24-win-x64' })
    expect(runtime.uses).toBe('./.github/workflows/build-exe-for-python-sdk.yml')
    const windowsJobs = Object.entries(ciWindows.jobs)
      .filter(([name]) => name !== 'windows-checks-passed')
    for (const [name, job] of windowsJobs) {
      if (!isRecord(job)) throw new TypeError(`${name} must define a job`)
      expect(job).not.toHaveProperty('strategy')
      expect(job).not.toHaveProperty('uses')
    }

    const builder = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    if (!isRecord(builder.jobs)) throw new TypeError('Python runtime builder must define jobs')
    expect(Object.keys(builder.jobs).sort()).toEqual(['build', 'plan', 'sdk-wheel'])
    const plan = workflowJob(builder, 'plan')
    const wheel = workflowJob(builder, 'sdk-wheel')
    const build = workflowJob(builder, 'build')
    expect(plan.needs).toBeUndefined()
    expect(plan.strategy).toBeUndefined()
    expect(plan.uses).toBeUndefined()
    expect(wheel.needs).toBe('plan')
    expect(wheel.strategy).toBeUndefined()
    expect(wheel.uses).toBeUndefined()
    expect(build.needs).toEqual(['plan', 'sdk-wheel'])
    expect(build.uses).toBeUndefined()
    if (!isRecord(build.strategy)) throw new TypeError('Python runtime build must define its target matrix')
    expect(build.strategy.matrix).toEqual({ include: '${{ fromJSON(needs.plan.outputs.matrix) }}' })

    // Python's runtime targets start only after the SDK suite; Windows starts
    // immediately. Plan and wheel stages precede the two-target matrix.
    const windowsActive = windowsJobs.length
    // The lint lane owns its own runner, so it raises the ceiling by one.
    const beforeSdk = ordinaryJobs.length + compatibilityLimit + windowsActive + 1
    const afterSdk = ordinaryJobs.length + compatibilityLimit + windowsActive + Math.max(1, targets.split(',').length)
    expect(beforeSdk).toBeLessThanOrEqual(11)
    expect(afterSdk).toBeLessThanOrEqual(11)
  })

  it('keeps the union of required PR verdicts equal to the pre-split blocking set', () => {
    const verdicts = [
      ['ci.yml', 'all-checks-passed'],
      ['ci-windows.yml', 'windows-checks-passed'],
      ['ci-python.yml', 'python-checks-passed'],
    ] as const
    const blocking: string[] = []
    for (const [file, name] of verdicts) {
      const workflow = loadWorkflow('.github/workflows/' + file)
      const verdict = workflowJob(workflow, name)
      if (!isRecord(workflow.jobs) || !Array.isArray(verdict.needs)) {
        throw new TypeError(`${file} must define jobs and the ${name} verdict needs`)
      }
      const jobs = workflow.jobs
      expect(verdict.needs.every(id => typeof id === 'string' && id in jobs)).toBe(true)
      blocking.push(...(verdict.needs as string[]))
    }
    // Splitting the workflows only moves jobs between verdicts; the blocking
    // set itself must stay identical, or branch protection would accept a
    // failure it rejected before the split.
    expect(blocking.sort()).toEqual([
      'node-24',
      'node-24-bench',
      'node-24-consumers',
      'node-24-coverage',
      'node-24-lint',
      'node-compat',
      'python-runtime',
      'python-sdk',
      'windows-build',
      'windows-native-tests',
    ])
  })

  it('retains aggregate diagnostics in required builds and protected publication', () => {
    for (const [file, name, command] of [
      ['ci.yml', 'node-24-consumers', 'pnpm run check:ci:consumers'],
      ['ci-windows.yml', 'windows-build', 'pnpm run check:ci:windows-blocking'],
    ] as const) {
      const job = workflowJob(loadWorkflow('.github/workflows/' + file), name)
      expect(job.steps).toContainEqual(expect.objectContaining({ run: command }))
    }
    const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    const hostSteps = scripts.scripts['build:lib:host']!.split(' && ')
    expect(hostSteps[0]).toBe('tsx scripts/compile-referenced-projects.ts host-libraries')
    expect(hostSteps).toContain('node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc -p tsconfig.host.json')
    expect(hostSteps.at(-1)).toBe('pnpm --filter @deepseek-ai/dsh-desktop run bundle')
    expect(scripts.scripts['build:lib:client']).toContain('tsc -b tsconfig.client.json')
    expect(scripts.scripts.typecheck).toBe('tsx scripts/build.ts --scope typecheck')
  })

  it('selects PR artifact compilation inside the Python executable builder', () => {
    const job = workflowJob(loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml'), 'build')
    if (!Array.isArray(job.steps)) throw new TypeError('Python runtime builder must define steps')
    const steps = job.steps.filter(isRecord)
    const execute = steps.find(step => step.name === 'Build single-exe')
    expect(steps.some(step => step.run === 'pnpm run build:artifacts')).toBe(false)
    expect(execute).toMatchObject({
      env: { DSH_BUILD_CLIENT_PROFILE: 'official' },
    })
    if (typeof execute?.run !== 'string') throw new TypeError('Python executable builder must define a command')
    const expression = [...execute.run.matchAll(/\$\{\{ ([^{}]+) \}\}/g)]
      .map(match => match[1]).find(value => value?.startsWith('inputs.ci'))
    expect(expression).toBe("inputs.ci && github.event_name == 'pull_request' && '--build-artifacts' || ''")
    if (expression === undefined) throw new TypeError('Python executable builder must select its build mode')
    for (const ci of [false, true]) {
      for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
        const context = { inputs: { ci }, github: { event_name: event } }
        const selected: unknown = runInNewContext(expression, context, { timeout: 1000 })
        expect(selected).toBe(ci && event === 'pull_request' ? '--build-artifacts' : '')
      }
    }
  })

  it('prepares confinement before Node compatibility smokes', () => {
    const job = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'node-compat')
    if (!Array.isArray(job.steps)) throw new TypeError('Node compatibility job must define steps')
    const steps = job.steps.filter(isRecord)
    const preparation = steps.findIndex(step => step.run === 'bash scripts/prepare-ci-bubblewrap.sh')
    const smoke = steps.findIndex(step => step.run === 'pnpm run check:node-compat')
    expect(preparation).toBeGreaterThanOrEqual(0)
    expect(smoke).toBeGreaterThan(preparation)
    expect(steps[preparation]).not.toHaveProperty('continue-on-error', true)
  })

  it.each(['ci.yml', 'ci-master.yml'])(
    '%s cancels superseded validation runs without crossing workflow or ref boundaries', (name) => {
      const workflow = loadWorkflow('.github/workflows/' + name)
      expect(workflow.concurrency).toEqual({
        group: '${{ github.workflow }}-${{ github.ref }}',
        'cancel-in-progress': true,
      })
    },
  )

  it('cancels reusable CI builds without cancelling release-owned builds', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    expect(workflow.concurrency).toEqual({
      group: 'build-single-exe-${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': '${{ !inputs.release }}',
    })
  })

  it('skips coverage-history uploads on cancellation but retains Wine cleanup', () => {
    const coverage = workflowJob(loadWorkflow('.github/workflows/ci-windows.yml'), 'windows-coverage')
    const wine = workflowJob(loadWorkflow('.github/workflows/ci-master.yml'), 'windows')
    expect(coverage.steps).toContainEqual(expect.objectContaining({
      name: 'Save coverage duration history', if: '${{ !cancelled() }}',
    }))
    expect(wine.steps).toContainEqual(expect.objectContaining({ name: 'Shut down wineserver', if: 'always()' }))
  })

  it.each([
    ['node-24-coverage', 'ci.yml', 'Linux', 'LINUX', 'pnpm run check:ci:coverage'],
    ['windows-coverage', 'ci-windows.yml', 'Windows', 'WINDOWS', 'pnpm run check:ci:coverage'],
  ])('reuses %s coverage timings only within its platform and runner pool', (jobName, file, platform, variable, command) => {
    const job = workflowJob(loadWorkflow('.github/workflows/' + file), jobName)
    if (!Array.isArray(job.steps)) throw new TypeError(`${jobName} must define steps`)
    const steps = job.steps.filter(isRecord)
    const checkout = steps.findIndex(step => step.uses === 'actions/checkout@v7.0.1')
    const restore = steps.findIndex(step => step.name === 'Restore coverage duration history')
    const coverage = steps.findIndex(step => step.run === command)
    const save = steps.findIndex(step => step.name === 'Save coverage duration history')
    const prefix = `coverage-times-${platform}-\${{ runner.environment }}-\${{ vars.DSH_CI_FAILOVER_${variable} || 'enterprise' }}-`
    const key = prefix + '${{ github.run_id }}-${{ github.run_attempt }}'
    expect(checkout).toBeGreaterThanOrEqual(0)
    expect(restore).toBeGreaterThan(checkout)
    expect(coverage).toBeGreaterThan(restore)
    expect(save).toBeGreaterThan(coverage)
    expect(steps[restore]).toMatchObject({
      uses: 'actions/cache/restore@v6.1.0',
      with: { path: '.coverage-times.json', key, 'restore-keys': `${prefix}\n` },
    })
    expect(steps[save]).toMatchObject({
      uses: 'actions/cache/save@v6.1.0',
      if: '${{ !cancelled() }}',
      with: { path: '.coverage-times.json', key },
    })
  })

  it('isolates every pnpm action setup destination per runner', () => {
    const files = ['.github/workflows/ci.yml', '.github/workflows/ci-windows.yml', '.github/workflows/ci-master.yml']
    const setups: Array<{ jobName: string; step: unknown }> = []
    for (const file of files) {
      const workflow: unknown = yaml.load(readFileSync(resolve(root, file), 'utf8'))
      if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
      for (const [jobName, job] of Object.entries(workflow.jobs)) {
        if (!isRecord(job) || !Array.isArray(job.steps)) continue
        for (const step of job.steps) {
          if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) continue
          setups.push({ jobName, step })
        }
      }
    }

    expect(setups.length).toBeGreaterThan(0)
    for (const { jobName, step } of setups) {
      const stepDest = (step as { with?: { dest?: unknown } }).with?.dest
      if (jobName.startsWith('windows-')) {
        expect(stepDest, `${jobName} must use the native Windows pnpm destination`).toBe(nativeWindowsPnpmDestination)
        expect(step).not.toMatchObject({ with: { standalone: true } })
      } else {
        expect(typeof stepDest, `${jobName} must use a runner-and-run-private pnpm destination`).toBe('string')
        expect(stepDest as string).toMatch(runnerPrivatePnpmDestination)
      }
    }
  })

  it.each(['node-24', 'node-24-coverage', 'node-24-consumers'])(
    '%s keeps tool and fixture temporary files under runner cleanup',
    (jobName) => {
      const job = workflowJob(loadWorkflow('.github/workflows/ci.yml'), jobName)
      if (!Array.isArray(job.steps)) throw new TypeError(`${jobName} must define steps`)
      expect(job.steps[0]).toEqual({
        name: 'Use runner-owned temporary storage',
        run: [
          'echo "TMPDIR=${{ runner.temp }}" >> "$GITHUB_ENV"',
          ...(jobName === 'node-24-consumers'
            ? ['echo "PLAYWRIGHT_BROWSERS_PATH=${RUNNER_TEMP%/*}/ms-playwright" >> "$GITHUB_ENV"']
            : []),
          '',
        ].join('\n'),
      })
      if (jobName === 'node-24-consumers') {
        const browserCache: unknown = job.steps.find(step => isRecord(step) && isRecord(step.with)
          && step.with.path === '${{ env.PLAYWRIGHT_BROWSERS_PATH }}')
        expect(browserCache).toMatchObject({ uses: 'actions/cache/restore@v6.1.0' })
      }
      const store: unknown = job.steps.find(step => isRecord(step) && step.name === 'Configure pnpm store path')
      expect(store).toMatchObject({
        run: [
          'store_root="$HOME/.local/share/pnpm/store"',
          'echo "PNPM_CONFIG_STORE_DIR=$store_root" >> "$GITHUB_ENV"',
          'store_path=$(PNPM_CONFIG_STORE_DIR="$store_root" pnpm store path --silent)',
          'echo "path=$store_path" >> "$GITHUB_OUTPUT"',
          '',
        ].join('\n'),
      })
      for (const step of job.steps) {
        if (isRecord(step) && isRecord(step.env)) {
          expect(step.env.TMPDIR).toBeUndefined()
          expect(step.env.npm_config_cache).toBeUndefined()
        }
      }
    },
  )

  it('isolates the python SDK exe pnpm setup destination per job', () => {
    const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/build-exe-for-python-sdk.yml'), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new TypeError('build-exe-for-python-sdk.yml must define jobs')
    const setups: Array<{ step: unknown }> = []
    for (const job of Object.values(workflow.jobs)) {
      if (!isRecord(job) || !Array.isArray(job.steps)) continue
      for (const step of job.steps) {
        if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) continue
        setups.push({ step })
      }
    }
    expect(setups.length).toBeGreaterThan(0)
    for (const { step } of setups) {
      expect(step).toMatchObject({
        with: { dest: nativeWindowsPnpmDestination },
      })
    }
  })

  it('keeps split native Windows PR jobs with failover in their own workflow, plus a master-only standby', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    const windowsWorkflow = loadWorkflow('.github/workflows/ci-windows.yml')
    const masterWorkflow = loadWorkflow('.github/workflows/ci-master.yml')
    if (!isRecord(workflow.jobs)
      || !isRecord(windowsWorkflow.jobs)
      || !isRecord(windowsWorkflow.jobs['windows-build'])
      || !isRecord(windowsWorkflow.jobs['windows-coverage'])
      || !isRecord(windowsWorkflow.jobs['windows-native-tests'])
      || !isRecord(windowsWorkflow.jobs['windows-checks-passed'])
      || !isRecord(workflow.jobs['node-24'])
      || !isRecord(workflow.jobs['node-24-coverage'])
      || !isRecord(workflow.jobs['node-24-lint'])
      || !isRecord(workflow.jobs['node-24-bench'])
      || !isRecord(workflow.jobs['node-24-consumers'])
      || !isRecord(workflow.jobs['node-compat'])
      || !isRecord(workflow.jobs['all-checks-passed'])
      || !isRecord(masterWorkflow.jobs)
      || !isRecord(masterWorkflow.jobs['serial-windows'])) {
      throw new TypeError('CI workflow must define node-24, node-24-coverage, node-24-lint, node-24-bench, node-24-consumers, node-compat, and all-checks-passed; CI Windows must define windows-build, windows-coverage, windows-native-tests, and windows-checks-passed; ci-master must define serial-windows')
    }

    const windowsBuild = windowsWorkflow.jobs['windows-build']
    const windowsCoverage = windowsWorkflow.jobs['windows-coverage']
    const windowsNativeTests = windowsWorkflow.jobs['windows-native-tests']
    const windowsAggregate = windowsWorkflow.jobs['windows-checks-passed']
    const serialWindows = masterWorkflow.jobs['serial-windows']
    const node24 = workflow.jobs['node-24']
    const node24Coverage = workflow.jobs['node-24-coverage']
    const node24Bench = workflow.jobs['node-24-bench']
    const node24Consumers = workflow.jobs['node-24-consumers']
    const nodeCompat = workflow.jobs['node-compat']
    const aggregate = workflow.jobs['all-checks-passed']
    if (!Array.isArray(aggregate.needs) || !Array.isArray(windowsAggregate.needs)) {
      throw new TypeError('CI and CI Windows aggregates must define needs')
    }
    expect(Object.keys(workflow.jobs).filter(name => name.startsWith('windows'))).toEqual([])
    // Native Windows lanes use one GitHub-hosted runner. The fork does not
    // route CI through Blacksmith, self-hosted, or dsh-* labels.
    for (const [jobName, job] of [['windows-build', windowsBuild], ['windows-coverage', windowsCoverage], ['windows-native-tests', windowsNativeTests]] as const) {
      expect(job['runs-on'], jobName).toBe('windows-latest')
      expect(job.if).toBe("github.event_name == 'pull_request'")
    }

    // windows-build runs the blocking build/site pair.
    expect(windowsBuild.name).toBe('windows node 24 / build & observational')
    const buildSteps = windowsBuild.steps as unknown[]
    const buildCommands = buildSteps.filter((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && typeof step.run === 'string'
    ))
    expect(buildCommands.map(step => step.run)).toContain('pnpm run check:ci:windows-blocking')

    // Native Windows installs branch on the workspace filesystem:
    // clone (ReFS block clone) only on ReFS, plain install elsewhere. This
    // keeps the TS6231 store-path leak (see the Windows ReFS store note) out
    // of the self-hosted pool without forcing clone onto hosted NTFS, which
    // rejects copy-on-write. The branch must stay, or a hosted fallback would
    // fail installs with ERR_PNPM_LINKING_FAILED.
    for (const [jobName, job] of [['windows-build', windowsBuild], ['windows-coverage', windowsCoverage], ['windows-native-tests', windowsNativeTests]] as const) {
      const steps = job.steps as unknown[]
      const install = steps.find((step): step is Record<string, unknown> & { run: string } => (
        isRecord(step) && step.name === 'Install (immutable)' && typeof step.run === 'string'
      ))
      expect(install, `${jobName} must define the filesystem-branched install`).toBeDefined()
      expect(install!.run).toContain("$fs -eq 'ReFS'")
      expect(install!.run).toContain('--package-import-method=clone')
      expect(install!.run).toContain('corepack pnpm install')
      // The else branch must keep the plain hosted install as a distinct line
      // (not the corepack clone line, which contains the same substring);
      // dropping it or making both branches clone would force clone onto
      // NTFS, which rejects copy-on-write (ERR_PNPM_LINKING_FAILED). The
      // YAML folded block keeps the first statement on line 1 and folds the
      // rest with leading two-space indents.
      const installLines = install!.run.split('\n').map(line => line.trim())
      expect(installLines).toContain('} else {')
      expect(installLines.some(line => line === 'pnpm install --frozen-lockfile'), `${jobName} else branch must keep the plain hosted install`).toBe(true)
      // The ReFS branch must not use the interpolated empty-flag form, which
      // passes a stray "" positional argument to pnpm.
      expect(install!.run).not.toContain('$cloneFlag')
    }

    expect(windowsCoverage.name).toBe('windows node 24 / coverage')
    expect(windowsCoverage.env).toMatchObject({ DSH_COVERAGE_PARTITIONS: "${{ vars.DSH_CI_FAILOVER_WINDOWS == 'selfhosted' && github.event.pull_request.user.login != 'dependabot[bot]' && '4' || '' }}" })
    const coverageSteps = windowsCoverage.steps as unknown[]
    const coverageCommands = coverageSteps.filter((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && typeof step.run === 'string'
    ))
    expect(coverageCommands.map(step => step.run)).toContain('pnpm run check:ci:coverage')
    // Windows coverage runs zero-build like the Linux lane: workspace imports
    // resolve to src through the tsconfig paths map, and the lib-consuming
    // suites (webworker-packer image-loadable, webworker-runtime
    // transform-corpus, client ui-trajectory client-bundle) self-skip on
    // unbuilt checkouts. The regex catches a regression spelled as
    // 'corepack pnpm run build' or folded into a multi-line run block, which
    // an exact string match would miss.
    expect(coverageCommands.every(step => !/\bpnpm\s+run\s+build(?:\s|$)/.test(step.run))).toBe(true)

    // windows-native-tests runs the Windows-specific specs.
    expect(windowsNativeTests.name).toBe('windows node 24 / native tests')
    const nativeTestSteps = windowsNativeTests.steps as unknown[]
    const nativeTestCommands = nativeTestSteps.filter((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && typeof step.run === 'string'
    ))
    const nativeTestCommand = nativeTestCommands.map(step => step.run).join('\n')
    expect(nativeTestCommand).toContain('--no-file-parallelism')
    expect(nativeTestCommand).toContain('--testTimeout 90000')
    expect(nativeTestCommand).toContain('tool-pwsh/tests/loader.spec.ts')
    expect(nativeTestCommand).toContain('workflow-ptc.spec.ts')

    expect(windowsWorkflow.jobs['windows-observational']).toBeUndefined()
    expect(windowsBuild['continue-on-error']).not.toBe(true)
    const observational = buildCommands.find(step => step.id === 'observational')
    expect(observational).toMatchObject({
      run: 'pnpm run check:ci:windows-observational-ready',
      shell: 'pwsh',
      'continue-on-error': true,
      'timeout-minutes': 15,
      env: {
        DSH_GATE_FAIL_FAST: '',
        DSH_PUBLINT_CONCURRENCY: "${{ vars.DSH_CI_FAILOVER_WINDOWS == 'selfhosted' && github.event.pull_request.user.login != 'dependabot[bot]' && '8' || '' }}",
      },
    })
    expect(observational?.if).toBeUndefined()
    expect(buildCommands.findIndex(step => step.id === 'observational'))
      .toBeGreaterThan(buildCommands.findIndex(step => step.run === 'pnpm run check:ci:windows-blocking'))
    const report = buildCommands.find(step => step.name === 'Report Windows observational failures')
    expect(report).toMatchObject({
      'continue-on-error': true,
      if: "steps.observational.outcome == 'failure'",
      shell: 'pwsh',
    })
    expect(report?.run).toContain('::warning::')
    expect(report?.run).toContain('Out-File -FilePath $env:GITHUB_STEP_SUMMARY -Encoding utf8 -Append')

    // serial-windows: master-only reference on a standard hosted runner.
    expect(serialWindows.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/master'")
    expect(serialWindows['runs-on']).toBe('windows-latest')
    expect(serialWindows.name).toBe('serial / windows')
    expect(serialWindows['timeout-minutes']).toBe(360)
    // Its store must share the ReFS workspace volume for clone; the install
    // must carry the same filesystem branch as the PR jobs.
    const serialSteps = serialWindows.steps as unknown[]
    const serialStore = serialSteps.find((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && step.name === 'Configure persistent pnpm store' && typeof step.run === 'string'
    ))
    expect(serialStore).toBeDefined()
    expect(serialStore!.run).toContain('[IO.Path]::GetPathRoot($env:GITHUB_WORKSPACE)')
    expect(serialStore!.run).toContain("'.pnpm-store'")
    const serialInstall = serialSteps.find((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && step.name === 'Install (immutable)' && typeof step.run === 'string'
    ))
    expect(serialInstall).toBeDefined()
    expect(serialInstall!.run).toContain("$fs -eq 'ReFS'")
    expect(serialInstall!.run).toContain('--package-import-method=clone')
    expect(serialInstall!.run).toContain('corepack pnpm install')
    // Distinct else-branch line, as for the PR jobs: the corepack clone line
    // contains the plain-install substring too.
    expect(serialInstall!.run.split('\n').map(line => line.trim())).toContain('} else {')
    expect(serialInstall!.run.split('\n').map(line => line.trim())).toContain('pnpm install --frozen-lockfile')
    expect(serialInstall!.run).not.toContain('$cloneFlag')
    // The unsharded reference runs the whole coverage inventory at the same
    // per-test budget the PR coverage lane grants; the default 5000ms times
    // out load-sensitive store scans (e.g. gen-third-party-notices).
    const serialGate = serialSteps.find((step): step is Record<string, unknown> & { env?: Record<string, unknown> } => (
      isRecord(step) && step.name === 'Run complete unsharded Windows gate inventory serially'
    ))
    expect(serialGate).toBeDefined()
    expect(serialGate!.env).toMatchObject({ DSH_COVERAGE_TEST_TIMEOUT_MS: '90000' })

    expect(aggregate.needs).not.toContain('windows')
    // windows-coverage is temporarily non-blocking while Windows ACP
    // half-close tests are stabilized; observational stays out too.
    expect(windowsAggregate.needs).toEqual(['windows-build', 'windows-native-tests'])
    expect(windowsAggregate.name).toBe('windows checks passed')
    expect(windowsAggregate['runs-on']).toBe(aggregate['runs-on'])
    expect(windowsAggregate.if).toBe(aggregate.if)
    // The benchmark lane is a required verdict input and runs alone so its
    // wall-clock budgets never share a runner with a concurrent aggregate.
    expect(aggregate.needs).toContain('node-24-bench')
    expect(node24Bench.name).toBe('node 24 / benchmarks')
    expect(node24Bench.env).toBeUndefined()
    expect(node24Bench.steps).toContainEqual({
      name: 'Install benchmark browser and hosted dependencies',
      run: 'pnpm --filter @deepseek-ai/dsh-benchmarks exec playwright install --with-deps chromium',
    })
    expect(JSON.stringify(node24Bench.steps)).not.toContain('DSH_CI_FAILOVER_LINUX')
    expect(node24Bench.steps).toContainEqual({
      name: 'Run performance benchmarks',
      env: { DSH_GATE_VERBOSE: '1' },
      run: 'pnpm run check:ci:bench',
    })
    expect(windowsAggregate.needs).not.toContain('serial-windows')

    // The three Linux workers and the verdict job use a standard hosted runner.
    for (const [jobName, job] of [['node-24', node24], ['node-24-coverage', node24Coverage], ['node-24-consumers', node24Consumers]] as const) {
      expect(job['runs-on'], jobName).toBe('ubuntu-latest')
    }
    expect(aggregate['runs-on']).toBe('ubuntu-latest')

    // The run-gates aggregate lanes stop at the first blocking gate failure so
    // a red aggregate does not keep burning runner time on the remaining
    // gates. Removing the flag silently reverts to running every independent
    // gate to completion.
    for (const [jobName, job] of [['node-24', node24], ['node-24-coverage', node24Coverage], ['node-24-consumers', node24Consumers], ['node-compat', nodeCompat]] as const) {
      expect(job.env, `${jobName} must enable fail-fast`).toMatchObject({ DSH_GATE_FAIL_FAST: '1' })
    }

    // The native Windows lanes with run-gates aggregates fail fast for the
    // same reason: a failing gate aborts the sibling gate instead of waiting
    // out the multi-minute instrumented coverage run.
    expect(windowsBuild.env, 'windows-build must enable fail-fast').toMatchObject({ DSH_GATE_FAIL_FAST: '1' })
    expect(windowsCoverage.env, 'windows-coverage must enable fail-fast').toMatchObject({ DSH_GATE_FAIL_FAST: '1' })

    // The observational lane stays complete: it is continue-on-error by design
    // and exists to collect as much Windows-native evidence per run as
    // possible, so the first failure must not truncate the rest.
    expect(observational?.env).toMatchObject({ DSH_GATE_FAIL_FAST: '' })
  })

  it('runs the darwin unit parity inventory at the coverage lanes\' test budget', () => {
    const coverage = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'node-24-coverage')
    if (!isRecord(coverage.env) || typeof coverage.env.DSH_COVERAGE_TEST_TIMEOUT_MS !== 'string') {
      throw new TypeError('node-24-coverage must grant DSH_COVERAGE_TEST_TIMEOUT_MS')
    }
    const unitDarwin = workflowJob(loadWorkflow('.github/workflows/sandbox.yml'), 'unit-darwin')
    if (!Array.isArray(unitDarwin.steps)) throw new TypeError('unit-darwin job must define steps')
    const unit = unitDarwin.steps.filter(isRecord).find(step => step.name === 'Unit tests (darwin parity)')
    // The whole unit inventory on a shared macos-latest runner pays the same
    // scheduling delay the coverage lanes absorb; the ci-unit aggregate is the
    // `pnpm run test` path that consumes the variable, and the value is the
    // coverage lane's so the two budget classes cannot drift apart.
    expect(unit).toMatchObject({
      run: 'pnpm run check:ci:unit',
      env: { DSH_COVERAGE_TEST_TIMEOUT_MS: coverage.env.DSH_COVERAGE_TEST_TIMEOUT_MS },
    })
  })

  it('runs keyless filename, sandbox, and benchmark jobs on GitHub-hosted runners', () => {
    const expectedFilenames = workflowJob(loadWorkflow('.github/workflows/expected-filenames.yml'), 'expected-filenames')
    const sandbox = workflowJob(loadWorkflow('.github/workflows/sandbox.yml'), 'sandbox-e2e')
    expect(expectedFilenames['runs-on']).toBe('ubuntu-latest')
    expect(sandbox['runs-on']).toBe('${{ matrix.os }}')
    for (const name of ['larger-runner-benchmark', 'consolidated-runner-benchmark'] as const) {
      const benchmark = workflowJob(loadWorkflow('.github/workflows/ci-master.yml'), name)
      if (!isRecord(benchmark.strategy) || !isRecord(benchmark.strategy.matrix) || !Array.isArray(benchmark.strategy.matrix.include)) {
        throw new TypeError(`${name} must define a matrix include list`)
      }
      expect(benchmark['runs-on']).toBe('${{ matrix.runner }}')
      expect(benchmark.strategy.matrix.include).toEqual(name === 'larger-runner-benchmark'
        ? [
          { platform: 'linux', runner: 'ubuntu-latest', workload: 'typecheck' },
          { platform: 'windows', runner: 'windows-latest', workload: 'production-site' },
        ]
        : [
          { platform: 'linux', runner: 'ubuntu-latest', workers: '4' },
          { platform: 'windows', runner: 'windows-latest', workers: '2' },
        ])
    }
  })

  it('runs required benchmarks on a GitHub-hosted runner', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    const benchmark = workflowJob(workflow, 'node-24-bench')
    const aggregate = workflowJob(workflow, 'all-checks-passed')

    // Wall-clock budgets need an otherwise idle GitHub-hosted runner. The fork
    // does not move this lane onto Blacksmith or a self-hosted pool.
    expect(benchmark['runs-on']).toBe('ubuntu-24.04')
    expect(JSON.stringify(benchmark.steps)).not.toContain('DSH_CI_FAILOVER_LINUX')
    expect(benchmark.if).toBe("github.event_name == 'pull_request'")
    expect(benchmark.needs).toBeUndefined()
    expect(benchmark['continue-on-error']).toBeUndefined()
    expect(benchmark.env).toBeUndefined()
    expect(aggregate.needs).toContain('node-24-bench')
  })

  it('always restores the hosted benchmark pnpm cache', () => {
    const benchmark = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'node-24-bench')
    if (!Array.isArray(benchmark.steps)) throw new TypeError('benchmark job must define steps')
    const caches = benchmark.steps.filter(step => isRecord(step) && step.uses === 'actions/cache/restore@v6.1.0')

    expect(caches).toHaveLength(1)
    expect(caches[0]).not.toHaveProperty('if')
    expect(caches[0]).toMatchObject({
      with: {
        path: '${{ steps.pnpm-store.outputs.path }}',
        key: "${{ runner.os }}-node-${{ env.PRIMARY_NODE_VERSION }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}",
      },
    })
  })

  it('bounds the complete benchmark job to twenty minutes', () => {
    const benchmark = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'node-24-bench')

    expect(benchmark['timeout-minutes']).toBe(20)
    expect(benchmark.steps).toContainEqual({
      name: 'Run performance benchmarks',
      env: { DSH_GATE_VERBOSE: '1' },
      run: 'pnpm run check:ci:bench',
    })
  })

  it('publishes the scaled benchmark report even when a budget fails', () => {
    const benchmark = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'node-24-bench')
    if (!Array.isArray(benchmark.steps)) throw new TypeError('benchmark job must define steps')

    expect(benchmark.steps).toContainEqual({
      name: 'Upload scaled benchmark report',
      if: '${{ !cancelled() }}',
      uses: 'actions/upload-artifact@v7.0.1',
      with: {
        name: 'benchmark-report',
        path: 'benchmarks/.dsh-report/',
        'include-hidden-files': true,
        'if-no-files-found': 'warn',
        'retention-days': 7,
      },
    })

    const uploadIndex = benchmark.steps.findIndex(step => isRecord(step) && step.name === 'Upload scaled benchmark report')
    const benchmarkIndex = benchmark.steps.findIndex(step => isRecord(step) && step.name === 'Run performance benchmarks')
    expect(uploadIndex).toBeGreaterThan(benchmarkIndex)
  })

  it('splits the Wine Host TypeScript compile and retains its heap budget', () => {
    const wineGates = readFileSync(resolve(root, 'scripts/wine-windows-gates.sh'), 'utf8')

    const references = wineGates.indexOf(
      'wine_node "$scratch/logs/host-references.log" --import tsx/esm scripts/compile-referenced-projects.ts host',
    )
    const aggregate = wineGates.indexOf(
      'wine_node "$scratch/logs/host-tsc.log" --max-old-space-size=8192 "$tsc_js" -p tsconfig.host.json --pretty false',
    )
    const metadata = wineGates.indexOf('wine_node "$scratch/logs/host-typert.log" --import tsx/esm scripts/generate-typert.ts')
    expect(metadata).toBeGreaterThan(-1)
    expect(references).toBeGreaterThan(metadata)
    expect(aggregate).toBeGreaterThan(references)
    expect(wineGates).not.toContain('-b tsconfig.host.json')
  })

  it('cancels superseded master runs without changing the post-merge job inventory', () => {
    const workflow = loadWorkflow('.github/workflows/ci-master.yml')
    const prWorkflow = loadWorkflow('.github/workflows/ci.yml')
    if (!isRecord(workflow.jobs) || !isRecord(workflow.concurrency)) {
      throw new TypeError('ci-master workflow must define jobs and a workflow-level concurrency block')
    }
    if (!isRecord(prWorkflow.jobs)) {
      throw new TypeError('ci workflow must define jobs')
    }

    expect(workflow.concurrency).toEqual({
      group: '${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': true,
    })
    expect(prWorkflow.concurrency).toEqual(workflow.concurrency)

    // The exact event sets are what keep master-only jobs out of the PR check
    // panel: ci-master triggers only on push(master) + workflow_dispatch and
    // never on pull_request; ci.yml is exactly pull_request-only. Assert the
    // full sets so losing the wrong event, or gaining an extra one, fails.
    if (!isRecord(workflow.on) || !isRecord(prWorkflow.on)) {
      throw new TypeError('both CI workflows must define on')
    }
    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch'])
    expect(Object.keys(prWorkflow.on)).toEqual(['pull_request'])
    const windowsWorkflow = loadWorkflow('.github/workflows/ci-windows.yml')
    if (!isRecord(windowsWorkflow.on)) throw new TypeError('CI Windows workflow must define on')
    expect(Object.keys(windowsWorkflow.on)).toEqual(['pull_request'])
    expect(windowsWorkflow.concurrency).toEqual(workflow.concurrency)
    // Duplicated env must not drift: a Node bump on one lane only would run
    // Linux and Windows against different versions.
    expect(windowsWorkflow.env).toEqual(prWorkflow.env)
    const pythonWorkflow = loadWorkflow('.github/workflows/ci-python.yml')
    if (!isRecord(pythonWorkflow.on)) throw new TypeError('CI Python workflow must define on')
    expect(Object.keys(pythonWorkflow.on)).toEqual(['pull_request'])
    expect(pythonWorkflow.concurrency).toEqual(workflow.concurrency)
    expect(pythonWorkflow.env).toEqual(prWorkflow.env)

    // Drills share the parent run’s supersession policy.
    for (const name of ['serial-linux-selfhosted', 'serial-windows']) {
      const job = workflow.jobs[name]
      if (!isRecord(job)) throw new TypeError(`${name} must be defined`)
      expect(job.concurrency).toBeUndefined()
      // Standby drills remain post-merge work, but share run cancellation.
      expect(job.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/master'")
    }

    // Pin the post-merge runtime, Wine, and standby inventory.
    const NOT_PUSH_REACHABLE = new Set([
      "github.event_name == 'workflow_dispatch' && inputs.suite == 'larger-runner-benchmark'",
      "github.event_name == 'workflow_dispatch' && inputs.suite == 'consolidated-runner-benchmark'",
    ])
    const pushReachable = Object.entries(workflow.jobs)
      .filter(([, job]) => {
        if (!isRecord(job)) return false
        if (job.if === undefined) return true // unconditional: runs on every event
        if (job.if === false) return false // `if: false` parses as a boolean
        if (typeof job.if !== 'string') return true // unrecognized shape: surface it
        return !NOT_PUSH_REACHABLE.has(job.if.trim())
      })
      .map(([name]) => name)
      .sort()
    expect(pushReachable).toEqual(['python-runtime', 'serial-linux-selfhosted', 'serial-windows', 'windows'])

    // Manual benchmarks run one Linux row and one Windows row, with a budget
    // that can finish on a 4-vCPU runner.
    for (const [name, timeout] of [['larger-runner-benchmark', 60], ['consolidated-runner-benchmark', 360]] as const) {
      const job = workflow.jobs[name]
      if (!isRecord(job) || !isRecord(job.strategy)) {
        throw new TypeError(`${name} must define a matrix strategy`)
      }
      expect(job.strategy['max-parallel']).toBe(2)
      expect(job['timeout-minutes']).toBe(timeout)
    }
  })

  it('redirects the Node compile cache to the data-volume runner temp before the first pnpm call', () => {
    const prWorkflow = loadWorkflow('.github/workflows/ci.yml')
    const masterWorkflow = loadWorkflow('.github/workflows/ci-master.yml')
    const redirectLanes = [
      [prWorkflow, 'node-24'],
      [prWorkflow, 'node-24-coverage'],
      [prWorkflow, 'node-24-consumers'],
      [masterWorkflow, 'serial-linux-selfhosted'],
    ] as const
    for (const [workflow, jobKey] of redirectLanes) {
      const job = workflowJob(workflow, jobKey)
      if (!Array.isArray(job.steps)) throw new TypeError(`${jobKey} must define steps`)
      const redirectStepIndex = job.steps.findIndex((step): step is Record<string, unknown> & { run: string } => (
        isRecord(step) && typeof step.run === 'string'
          && step.run.includes('NODE_COMPILE_CACHE=${{ runner.temp }}/node-compile-cache')
          && step.run.includes('"$GITHUB_ENV"')
      ))
      // Removing this injection would send every pnpm call in the lane (setup,
      // store-path probe, install, and the gate) back to the root partition's
      // /tmp; rationale in
      // .github/workflows/ci.yml.
      expect(redirectStepIndex, `${jobKey} must inject NODE_COMPILE_CACHE into GITHUB_ENV`).toBeGreaterThan(-1)
      const pnpmSetupIndex = job.steps.findIndex((step): step is Record<string, unknown> & { uses: string } => (
        isRecord(step) && typeof step.uses === 'string' && step.uses.includes('pnpm/action-setup')
      ))
      expect(pnpmSetupIndex, `${jobKey} must run pnpm/action-setup`).toBeGreaterThan(-1)
      expect(redirectStepIndex, `${jobKey} must redirect before pnpm/action-setup runs pnpm`).toBeLessThan(pnpmSetupIndex)
    }
  })

  it('keeps supported LSP source under native Windows coverage', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain('packages/lsp/lsp-stdio/src/connection.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/index.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/instance.ts')
  })

  it('requires release-shaped Python runtime validation on Linux and Windows x64 in CI Python', () => {
    const workflow = loadWorkflow('.github/workflows/ci-python.yml')
    const pythonRuntime = workflowJob(workflow, 'python-runtime')
    const aggregate = workflowJob(workflow, 'python-checks-passed')
    if (!Array.isArray(aggregate.needs)) {
      throw new TypeError('CI Python aggregate must define required job dependencies')
    }

    expect(pythonRuntime).toMatchObject({
      if: "github.event_name == 'pull_request'",
      name: 'python runtime / release-shaped matrix',
      uses: './.github/workflows/build-exe-for-python-sdk.yml',
      with: { targets: 'node24-linux-x64,node24-win-x64', ci: true },
      secrets: {
        DEEPSEEK_API_KEY_EXTERNAL: '${{ secrets.DEEPSEEK_API_KEY_EXTERNAL }}',
      },
    })
    expect(aggregate.needs).toEqual(['python-sdk', 'python-runtime'])
    for (const file of ['ci.yml', 'ci-windows.yml']) {
      const other = loadWorkflow('.github/workflows/' + file)
      if (!isRecord(other.jobs)) throw new TypeError(`${file} must define jobs`)
      expect(other.jobs).not.toHaveProperty('python-runtime')
    }
  })

  it('keeps every Vitest project process-isolated on native Windows', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain("pool: process.platform === 'win32' ? 'threads' : 'forks'")
    expect(config.match(/pool: 'forks'/g)).toHaveLength(2)
  })

  it('applies the lane test budget inside every Vitest project', () => {
    // Each inline project spreads coverageTestTimeoutOptions, the only route
    // for DSH_COVERAGE_TEST_TIMEOUT_MS into projects; the behavior itself is
    // pinned by scripts/lane-test-budget.spec.ts.
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).toContain('const laneTestBudget = coverageTestTimeoutOptions(process.env[COVERAGE_TEST_TIMEOUT_ENV])')
    expect(config.match(/^ {10}\.\.\.laneTestBudget,$/gm)).toHaveLength(2)
  })
})

describe('Python runtime builder routing', () => {
  it('keeps native builders on the runner the plan step records', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    const build = workflowJob(workflow, 'build')
    expect(build['runs-on']).toBe('${{ matrix.runner }}')
    for (const [target, runner] of [
      ['node24-linux-x64', 'ubuntu-latest'],
      ['node24-win-x64', 'windows-2025'],
      ['node24-linux-arm64', 'ubuntu-24.04-arm'],
      ['node24-macos-arm64', 'macos-latest'],
      ['node24-macos-x64', 'macos-15-intel'],
    ] as const) {
      expect(evaluateRunsOn(build['runs-on'], { matrix: { target, runner } }), target).toBe(runner)
    }
  })

  it.each(['plan', 'sdk-wheel'])('routes runtime %s to a standard hosted runner', (name) => {
    const job = workflowJob(loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml'), name)
    expect(job['runs-on']).toBe('ubuntu-latest')
  })
})

describe('bubblewrap preparation script', () => {
  it('pins bubblewrap to a recorded Launchpad build and excludes Ubuntu pool downloads', () => {
    const script = readFileSync(resolve(root, 'scripts/prepare-ci-bubblewrap.sh'), 'utf8')
    const url = /^readonly BUBBLEWRAP_URL="([^"]+)"$/mu.exec(script)?.[1]

    expect(url).toMatch(
      /^https:\/\/launchpad\.net\/ubuntu\/\+source\/bubblewrap\/[^/]+\/\+build\/\d+\/\+files\/bubblewrap_[^/]+_amd64\.deb$/u,
    )
    // Ubuntu removes superseded versions from its live package pool.
    expect(script).not.toMatch(/https?:\/\/[^/'"\s]+\/ubuntu(?:-ports)?\/pool\//u)
  })
})

describe('Python executable builder', () => {
  it('exposes the native wheel builder to the release caller with normalized versions', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    expect(Object.keys(workflow.on as Record<string, unknown>).sort()).toEqual(['workflow_call', 'workflow_dispatch'])
    const call = workflowEvent(workflow, 'workflow_call')
    const plan = workflowJob(workflow, 'plan')
    const build = workflowJob(workflow, 'build')
    if (!isRecord(call.inputs) || !isRecord(call.secrets) || !Array.isArray(plan.steps) || !Array.isArray(build.steps)) {
      throw new TypeError('Python wheel builder must define workflow_call inputs and plan steps')
    }

    const buildSteps: unknown[] = build.steps
    const manylinuxAddon = buildSteps.find(step => isRecord(step) && step.name === 'Rebuild Linux node-pty against manylinux 2.28')
    const macosCheck = buildSteps.find(step => isRecord(step) && step.name === 'Check macOS payload architecture and deployment target')
    const manylinuxSmoke = buildSteps.find(step => isRecord(step) && step.name === 'Run wheel in a manylinux 2.28 container')
    const cleanVenvPosix = buildSteps.find(step => isRecord(step) && step.name === 'Install local SDK and runtime wheels into a clean venv (POSIX)')
    const cleanVenvWindows = buildSteps.find(step => isRecord(step) && step.name === 'Install local SDK and runtime wheels into a clean venv (Windows)')
    const installedKeylessPosix = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel keyless black-box tests (POSIX)')
    const installedKeylessWindows = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel keyless black-box tests (Windows)')
    const realApiPreflightPosix = buildSteps.find(step => isRecord(step) && step.name === 'Preflight installed-wheel real API test (POSIX)')
    const realApiPreflightWindows = buildSteps.find(step => isRecord(step) && step.name === 'Preflight installed-wheel real API test (Windows)')
    const installedRealApiPosix = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel real API black-box test (POSIX)')
    const installedRealApiWindows = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel real API black-box test (Windows)')
    if (!isRecord(macosCheck) || typeof macosCheck.run !== 'string'
      || !isRecord(cleanVenvPosix) || !isRecord(cleanVenvWindows)
      || !isRecord(installedKeylessPosix) || !isRecord(installedKeylessWindows)
      || !isRecord(realApiPreflightPosix) || !isRecord(realApiPreflightWindows)
      || !isRecord(installedRealApiPosix) || !isRecord(installedRealApiWindows)) {
      throw new TypeError('Python wheel builder must define native POSIX and Windows installed-wheel steps')
    }
    expect(call.inputs).toHaveProperty('targets')
    expect(call.inputs).toMatchObject({
      ci: { type: 'boolean', default: false },
      release: { type: 'boolean', default: false },
    })
    expect(call.secrets).toMatchObject({
      DEEPSEEK_API_KEY_EXTERNAL: { required: false },
    })
    expect(workflow.concurrency).toMatchObject({
      group: 'build-single-exe-${{ github.workflow }}-${{ github.ref }}',
    })
    expect(build.defaults).toBeUndefined()
    expect(plan.if).toContain('inputs.ci')
    expect(plan.if).toContain('inputs.release')
    expect(JSON.stringify(plan.steps)).toContain('pep440_version')
    const workflowJson = JSON.stringify(workflow)
    expect(workflowJson).toContain('macosx_14_0_arm64')
    expect(workflowJson).toContain('macosx_14_0_x86_64')
    expect(workflowJson).toContain('node24-macos-x64')
    expect(workflowJson).toContain('macos-15-intel')
    expect(workflowJson).toContain('win_amd64')
    expect(workflowJson).toContain('node24-win-x64')
    expect(workflowJson).toContain('windows-2025')
    expect(workflowJson).toContain('dist-python/$SDK_WHEEL')
    expect(workflowJson).toContain('dist-python/$RUNTIME_WHEEL')
    expect(workflowJson).toContain('/work/dist-python/$SDK_WHEEL')
    expect(workflowJson).toContain('/work/dist-python/$RUNTIME_WHEEL')
    expect(workflowJson).not.toContain('--find-links dist-python')
    expect(workflowJson).not.toContain('--find-links /work/dist-python')
    expect(workflowJson).not.toContain('cygpath')
    expect(manylinuxAddon).toMatchObject({ if: "runner.os == 'Linux'" })
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_x86_64')
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_aarch64')
    expect(JSON.stringify(manylinuxAddon)).toContain('npm_config_build_from_source=true pnpm --config.verifyDepsBeforeRun=false run install')
    expect(JSON.stringify(manylinuxAddon)).toContain('pnpm_setup_root')
    expect(JSON.stringify(manylinuxAddon)).toContain('$pnpm_setup_root:$pnpm_setup_root:ro')
    expect(JSON.stringify(manylinuxAddon)).toContain('node-pty-glibc-versions.txt')
    expect(JSON.stringify(manylinuxAddon)).toContain('le 2.28')
    expect(macosCheck).toMatchObject({ if: "runner.os == 'macOS'" })
    expect(macosCheck.run).toContain('scripts/check-macos-deployment-target.py')
    expect(macosCheck.run).toContain('lipo "$payload" -verify_arch')
    expect(macosCheck.run).toContain('$EXE-rg')
    expect(macosCheck.run).toContain('$EXE-spawn-helper')
    expect(JSON.stringify(installedKeylessPosix)).toContain('--scenario all')
    expect(JSON.stringify(installedKeylessPosix)).toContain('env -u PYTHONPATH')
    expect(JSON.stringify(installedKeylessWindows)).toContain('--scenario all --installed-wheel')
    expect(installedKeylessWindows).toMatchObject({ if: "runner.os == 'Windows'", shell: 'pwsh' })
    expect(cleanVenvWindows).toMatchObject({ if: "runner.os == 'Windows'", shell: 'pwsh' })
    expect(JSON.stringify(cleanVenvWindows)).toContain('Scripts\\\\python.exe')
    expect(realApiPreflightPosix).toMatchObject({
      env: { DEEPSEEK_API_KEY: '${{ secrets.DEEPSEEK_API_KEY_EXTERNAL }}' },
    })
    expect(String(realApiPreflightPosix.if)).toContain('inputs.ci')
    expect(String(realApiPreflightPosix.if)).toContain('head.repo.fork')
    expect(String(realApiPreflightPosix.if)).toContain('dependabot[bot]')
    expect(realApiPreflightWindows).toMatchObject({ shell: 'pwsh' })
    for (const step of [installedRealApiPosix, installedRealApiWindows]) {
      expect(step).toMatchObject({
        env: {
          DEEPSEEK_API_KEY: '${{ secrets.DEEPSEEK_API_KEY_EXTERNAL }}',
          DEEPSEEK_BASE_URL: 'https://api.deepseek.com/anthropic',
        },
      })
    }
    expect(JSON.stringify(installedRealApiPosix)).toContain('--scenario sdk-live')
    expect(JSON.stringify(installedRealApiPosix)).toContain('-u DSH_RUNTIME_MODE')
    expect(installedRealApiWindows).toMatchObject({ shell: 'pwsh' })
    expect(JSON.stringify(installedRealApiWindows)).toContain('--scenario sdk-live --installed-wheel')
    expect(manylinuxSmoke).toMatchObject({ if: "runner.os == 'Linux'" })
    expect(JSON.stringify(manylinuxSmoke)).toContain('-e DSH_TELEMETRY_DISABLED')
  })

  it('uses the shared macOS deployment-target check in GitLab', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const runtimeWheel = workflow['.runtime-wheel']
    if (!isRecord(runtimeWheel) || !Array.isArray(runtimeWheel.script)) {
      throw new TypeError('GitLab CI must define the runtime wheel script')
    }
    const runtimeScript: unknown[] = runtimeWheel.script
    const macosCheck = runtimeScript.find(
      step => typeof step === 'string' && step.includes('${PLATFORM#macos-}'),
    )
    if (typeof macosCheck !== 'string') {
      throw new TypeError('GitLab CI must check the macOS deployment target')
    }

    expect(macosCheck).toContain('scripts/check-macos-deployment-target.py')
    expect(macosCheck).toContain('lipo "$payload" -verify_arch')
    expect(macosCheck).toContain('"$EXE" "$EXE-rg" "$EXE-spawn-helper"')
  })

  it('builds the macOS x64 wheel on the matching GitLab runner', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const macosX64 = workflow['runtime-macos-x64']
    const publish = workflow['publish-python']
    if (!isRecord(macosX64) || !isRecord(publish) || !Array.isArray(publish.needs)) {
      throw new TypeError('GitLab CI must define the macOS x64 runtime and publication jobs')
    }

    expect(macosX64.tags).toEqual(['macos-x64'])
    expect(macosX64.variables).toMatchObject({ PKG_TARGET: 'node24-macos-x64', PLATFORM: 'macos-x64' })
    expect(publish.needs).toContainEqual({ job: 'runtime-macos-x64', artifacts: true })
    expect(JSON.stringify(publish.script)).toContain('macosx_14_0_x86_64.whl')
  })

  it('builds and black-box tests the Windows x64 wheel in GitLab', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const windows = workflow['runtime-windows-x64']
    const publish = workflow['publish-python']
    if (!isRecord(windows) || !Array.isArray(windows.before_script) || !Array.isArray(windows.script)
      || !isRecord(publish) || !Array.isArray(publish.needs)) {
      throw new TypeError('GitLab CI must define the Windows runtime and aggregate publication jobs')
    }

    expect(windows.tags).toEqual(['windows-x64'])
    expect(windows.variables).toMatchObject({ PKG_TARGET: 'node24-win-x64', PLATFORM: 'win-x64' })
    expect(JSON.stringify(windows.before_script)).toContain('.ci-python\\\\Scripts')
    expect(JSON.stringify(windows.before_script)).toContain('[IO.Path]::PathSeparator')
    expect(JSON.stringify(windows.script)).toContain('win_amd64.whl')
    expect(JSON.stringify(windows.script)).toContain('--scenario all --installed-wheel')
    expect(publish.needs).toContainEqual({ job: 'runtime-windows-x64', artifacts: true })
  })
})

describe('Git hooks', () => {
  it('leaves frozen Agent Note sidecars to the archive verifier', () => {
    const lefthook = loadWorkflow('lefthook.yml')

    for (const hookName of ['pre-commit', 'pre-merge-commit']) {
      const hook = lefthook[hookName]
      if (!isRecord(hook) || !Array.isArray(hook.jobs)) {
        throw new TypeError(`lefthook must define ${hookName} jobs`)
      }
      const pairing: unknown = hook.jobs.find(
        (job: unknown) => isRecord(job) && job.name === 'translation pairing (staged records)',
      )

      expect(pairing).toMatchObject({ exclude: ['.agents/notes/archived/**'] })
    }
  })
})

function loadWorkflow(path: string): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError(`${path} must define a workflow`)
  return workflow
}

function workflowEvent(workflow: Record<string, unknown>, event: string): Record<string, unknown> {
  if (!isRecord(workflow.on) || !isRecord(workflow.on[event])) {
    throw new TypeError(`workflow must define the ${event} event`)
  }
  return workflow.on[event]
}

function workflowJob(workflow: Record<string, unknown>, job: string): Record<string, unknown> {
  if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs[job])) {
    throw new TypeError(`workflow must define the ${job} job`)
  }
  return workflow.jobs[job]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

describe('Policy workflow shells', () => {
  it.each(['pr-check-on-head-branch.yml', 'pr-check-after-approve.yml', 'pr-check-on-base-branch.yml'])(
    '%s runs shell blocks that parse',
    (file) => {
      if (process.platform === 'win32') return
      const workflow = loadWorkflow('.github/workflows/' + file)
      if (!isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
      for (const job of Object.values(workflow.jobs)) {
        if (!isRecord(job) || !Array.isArray(job.steps)) continue
        for (const step of job.steps) {
          if (!isRecord(step) || typeof step.run !== 'string') continue
          const parsed = spawnSync('bash', ['-n'], { input: step.run, encoding: 'utf8' })
          expect(`${String(step.name ?? step.id)}: ${parsed.status}: ${parsed.stderr}`).toBe(`${String(step.name ?? step.id)}: 0: `)
        }
      }
    },
  )
})

describe('Policy workflows', () => {
  const workflows = [
    ['pr-check-on-head-branch.yml', ['master']],
    ['pr-check-after-approve.yml', ['approve', 'review']],
  ] as const

  function stepsOf(job: Record<string, unknown>): Record<string, unknown>[] {
    const steps = job.steps as unknown[]
    if (!Array.isArray(steps)) throw new TypeError('job must define steps')
    return steps.filter(isRecord)
  }

  it.each(workflows)('%s runs each check from master and reads its mode from a repository variable', (file, jobs) => {
    const workflow = loadWorkflow('.github/workflows/' + file)
    expect(Object.keys(workflow).filter(key => key !== 'name')).toEqual(['on', 'permissions', 'concurrency', 'jobs'])
    const events = workflow.on
    if (!isRecord(events)) throw new TypeError(`${file} must declare events`)
    expect(events).not.toHaveProperty('pull_request')
    expect(events).toHaveProperty('pull_request_target')
    for (const job of jobs) {
      const check = stepsOf(workflowJob(workflow, job)).find(step => typeof step.uses === 'string' && step.uses.startsWith('deepseek-harness/deepseek-harness-check@'))
      if (check === undefined || !isRecord(check.env)) throw new TypeError(`${file} ${job} must run the check action with env`)
      expect(String(check.env.CHECK_MODE)).toContain('vars.MERGE_POLICY_')
    }
  })

  it('keeps the pre-merge build behind the merge step, which honours the mode on its failures', () => {
    const steps = stepsOf(workflowJob(loadWorkflow('.github/workflows/pr-check-on-head-branch.yml'), 'pre-merge'))
    const merge = steps.findIndex(step => step.id === 'merge')
    const build = steps.findIndex(step => step.name === "Run the tree's pre-merge check")
    expect(merge).toBeGreaterThanOrEqual(0)
    expect(build).toBeGreaterThan(merge)
    const merging = steps[merge]
    if (merging === undefined || !isRecord(merging.env)) throw new TypeError('the merge step must set env')
    expect(String(merging.env.CHECK_MODE)).toContain('MERGE_POLICY_PRE_MERGE')
    for (const step of steps.slice(merge)) {
      if (typeof step.run !== 'string') continue
      expect(step.run).toContain('"$CHECK_MODE" = block')
    }
    for (const step of steps.slice(merge + 1)) expect(step.if).toBe("steps.merge.outputs.merged == 'true'")
    const run = steps[build]?.run
    if (typeof run !== 'string') throw new TypeError('the pre-merge check step must run a command')
    expect(run).toContain('node scripts/pre-merge-check.ts')
    // The script annotates its own failures; the step keeps a mode-aware guard for a check that crashes.
    expect(run).toContain('exited without reporting')
    expect(run).toContain('"$CHECK_MODE" = block')
  })
})
