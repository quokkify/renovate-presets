import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { Socket } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test, { mock } from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));

// npx puts its package binaries on PATH, but not on this file's import path.
// Import the exact Renovate installation used by the schema validator.
const binary = process.env.PATH.split(path.delimiter)
  .map((dir) => path.join(dir, 'renovate'))
  .find((candidate) => existsSync(candidate));
assert.ok(binary, 'Run via npx --package renovate --call "node --test tests/*.test.mjs"');
const renovateRoot = path.resolve(path.dirname(realpathSync(binary)), '..');
const load = (name) => import(pathToFileURL(path.join(renovateRoot, 'dist', name)));
const { resolveConfigPresets, presetSources } = await load('config/presets/index.js');
const { applyPackageRules } = await load('util/package-rules/index.js');
const { init: resetCache } = await load('util/cache/memory/index.js');
const { init: initLogger } = await load('logger/index.js');
await initLogger();
mock.method(Socket.prototype, 'connect', () => {
  assert.fail('Policy tests must not open network connections');
});

// Only replace transport. Renovate itself resolves built-ins, nested extends,
// relative references, mergeable arrays, rule order, and dependency matchers.
// Unrecognised external presets fail instead of fetching main or using stubs.
let mutatePreset;
for (const source of Object.keys(presetSources)) {
  presetSources[source].load = async () => ({
    async getPreset({ repo, presetPath, presetName }) {
      assert.equal(source, 'github', `Unexpected external source: ${source}`);
      assert.equal(repo, 'quokkify/renovate-presets');
      const file = path.resolve(root, presetPath ?? '', `${presetName}.json`);
      assert.ok(file.startsWith(root), `Preset escaped checkout: ${file}`);
      const config = JSON.parse(readFileSync(file, 'utf8'));
      mutatePreset?.(path.relative(root, file), config);
      return config;
    },
  });
}

const ref = (preset) => `github>quokkify/renovate-presets//presets/${preset}`;
async function resolve(presets, mutation) {
  resetCache();
  mutatePreset = mutation;
  try {
    return (await resolveConfigPresets({ extends: presets.map(ref) })).config;
  } finally {
    mutatePreset = undefined;
  }
}

const dependency = (manager, depName, updateType, extra = {}) => ({
  manager,
  depName,
  packageName: depName,
  updateType,
  packageFile: manager === 'github-actions' ? '.github/workflows/build.yml' : 'project-file',
  ...extra,
});
const effective = (config, dep) => applyPackageRules({ ...config, ...dep });
function manualMajor(result) {
  assert.equal(result.automerge, false, 'Major update must not automerge');
  assert.equal(result.dependencyDashboardApproval, true, 'Major update needs dashboard approval');
  assert.equal(result.prCreation, 'approval', 'Major PR must wait for approval');
}
function safeNonMajor(result) {
  assert.equal(result.automerge, true);
  assert.equal(result.dependencyDashboardApproval, false);
  assert.equal(result.minimumReleaseAge, '3 days');
}
function* permutations(values) {
  if (!values.length) yield [];
  for (const [index, value] of values.entries()) {
    for (const rest of permutations(values.filter((_, i) => i !== index))) yield [value, ...rest];
  }
}

test('GitHub Actions inherit manual major and stable non-major gates, including java-jdk', { timeout: 30_000 }, async () => {
  const config = await resolve(['github-actions/default']);
  for (const [name, extra] of [['actions/checkout', {}], ['java-jdk', { depType: 'uses-with' }]]) {
    const major = await effective(config, dependency('github-actions', name, 'major', extra));
    manualMajor(major);
    assert.deepEqual(major.schedule, ['before 6am on Monday']);
    for (const update of ['patch', 'minor', 'digest']) {
      safeNonMajor(await effective(config, dependency('github-actions', name, update, extra)));
    }
  }
});

test('base and all composition orders preserve update policy across managers and scoped groups', { timeout: 120_000 }, async (t) => {
  const combinations = [['base'], ...permutations([
    'docker/default', 'npm/default', 'gradle/default', 'github-actions/default',
  ])];
  const deps = [
    ['dockerfile', 'postgres'], ['docker-compose', 'node'],
    ['dockerfile', 'python'], ['docker-compose', 'nginx'],
    ['dockerfile', 'traefik'], ['npm', '@playwright/test'], ['npm', 'react'],
    ['npm', 'vitest', { sourceUrl: 'https://github.com/vitest-dev/vitest' }],
    ['gradle', 'org.hibernate.orm:hibernate-core'],
    ['gradle', 'com.atlassian:annotations'],
    ['github-actions', 'actions/checkout'],
    ['github-actions', 'java-jdk', { depType: 'uses-with' }],
  ];
  for (const presets of combinations) {
    await t.test(presets.join(' + '), { timeout: 30_000 }, async () => {
      const config = await resolve(presets);
      for (const [manager, name, extra] of deps) {
        manualMajor(await effective(config, dependency(manager, name, 'major', extra)));
        for (const update of ['patch', 'minor', 'digest']) {
          safeNonMajor(await effective(config, dependency(manager, name, update, extra)));
        }
      }
      const lockfile = await effective(config, dependency('npm', 'lockfile', 'lockFileMaintenance'));
      assert.equal(lockfile.automerge, true);
      assert.equal(lockfile.dependencyDashboardApproval, false);
      assert.equal(lockfile.automergeType, 'pr');
      assert.equal(lockfile.platformAutomerge, true);
      // Enabled:false remains authoritative even when non-major automerge is true.
      for (const update of ['major', 'minor', 'patch', 'digest']) {
        assert.equal((await effective(config, dependency('copier', 'template', update))).enabled, false);
        for (const file of [
          'allure-report', 'codeql', 'copier-update', 'gitleaks', 'release', 'validate',
        ]) {
          const dep = dependency('github-actions', 'actions/checkout', update, {
            packageFile: `.github/workflows/${file}.yml`,
          });
          assert.equal((await effective(config, dep)).enabled, false);
        }
      }
    });
  }
});

test('Gradle exclusions remain disabled and do not disable adjacent packages', { timeout: 30_000 }, async () => {
  const config = await resolve(['gradle/default', 'github-actions/default']);
  for (const update of ['major', 'minor', 'patch']) {
    for (const name of ['org.codehaus.mojo:versions-maven-plugin', 'com.epam.reportportal:agent']) {
      assert.equal((await effective(config, dependency('gradle', name, update))).enabled, false);
    }
    assert.notEqual((await effective(config, dependency('gradle', 'org.codehaus.mojo:other', update))).enabled, false);
  }
  assert.notEqual((await effective(config, dependency('github-actions', 'actions/checkout', 'minor'))).enabled, false);
});

test('contract detects the original broad automerge override in the actual composed preset', { timeout: 30_000 }, async () => {
  const config = await resolve(['github-actions/default'], (file, preset) => {
    if (file === 'presets/github-actions/default.json') {
      const broadRule = preset.packageRules.find((rule) =>
        rule.matchManagers?.includes('github-actions') && !rule.matchUpdateTypes);
      assert.ok(broadRule, 'Expected the GitHub Actions scheduling rule');
      broadRule.automerge = true;
    }
  });
  const result = await effective(config, dependency('github-actions', 'java-jdk', 'major', {
    depType: 'uses-with',
  }));
  assert.throws(() => manualMajor(result), /Major update must not automerge/);
});
