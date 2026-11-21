import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
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
const template = await load('util/template/index.js');
const { getConfig: getDefaultConfig } = await load('config/defaults.js');
const { mergeChildConfig } = await load('config/utils.js');
const { generateBranchName } = await load('workers/repository/updates/branch-name.js');
const { Vulnerabilities } = await load('workers/repository/process/vulnerabilities.js');
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
let requestedPresets = [];
for (const source of Object.keys(presetSources)) {
  presetSources[source].load = async () => ({
    async getPreset({ repo, presetPath, presetName, tag }) {
      assert.equal(source, 'github', `Unexpected external source: ${source}`);
      assert.equal(repo, 'quokkify/renovate-presets');
      requestedPresets.push({ presetPath, presetName, tag });
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
  return resolveReferences(presets.map(ref), mutation);
}
async function resolveReferences(references, mutation) {
  resetCache();
  requestedPresets = [];
  mutatePreset = mutation;
  try {
    return (await resolveConfigPresets({ extends: references })).config;
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

test('tagged presets inherit the release tag across the full graph; unpinned pilots use default branch', { timeout: 30_000 }, async () => {
  const entries = ['gradle/service', 'gradle/q4j', 'docker/default', 'npm/default', 'python/default',
    'github-actions/default', 'migrations/javax-to-jakarta', 'hardening/supply-chain', 'grouping/coupled-stacks'];
  const expectedFiles = ['default.json', ...readdirSync(path.join(root, 'presets'), { recursive: true })
    .filter((file) => file.endsWith('.json')).map((file) => `presets/${file}`)].sort();
  for (const tag of ['v9.9.9-test', undefined]) {
    const suffix = tag ? `#${tag}` : '';
    const references = [`github>quokkify/renovate-presets${suffix}`,
      ...entries.map((entry) => `${ref(entry)}${suffix}`)];
    const config = await resolveReferences(references);
    assert.ok(requestedPresets.length > entries.length, 'Nested presets must actually resolve');
    assert.deepEqual([...new Set(requestedPresets.map(({ presetPath, presetName }) =>
      [presetPath, `${presetName}.json`].filter(Boolean).join('/')))].sort(), expectedFiles);
    for (const requested of requestedPresets) {
      assert.equal(requested.tag, tag, `Nested preset escaped release: ${JSON.stringify(requested)}`);
    }
    manualMajor(await effective(config, dependency('github-actions', 'actions/checkout', 'major')));
  }
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
          'allure-report', 'codeql', 'copier-update', 'gitleaks', 'labels', 'pr-contract', 'release', 'validate',
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

test('opt-in gradle/q4j groups q4j modules in one group across catalogs; archgate and others do not', { timeout: 30_000 }, async () => {
  const config = await resolve(['gradle/default', 'gradle/q4j', 'github-actions/default']);
  const defaults = await resolve(['gradle/default']);
  assert.notEqual((await effective(defaults, dependency('gradle', 'dev.quokkify:q4j-core', 'minor'))).groupName, 'q4j', 'gradle/default must not group q4j');
  for (const [name, file] of [
    ['dev.quokkify:q4j-core', 'gradle/libs.versions.toml'],
    ['dev.quokkify:q4j-selenide', 'seed/gradle/seed.versions.toml'],
  ]) {
    for (const update of ['major', 'minor', 'patch']) {
      const result = await effective(config, dependency('gradle', name, update, { packageFile: file }));
      assert.equal(result.groupName, 'q4j');
      assert.equal(result.groupSlug, 'q4j');
    }
  }
  for (const name of ['dev.quokkify.archgate:archgate-core', 'dev.quokkify.archgate:rules-archunit', 'org.hibernate.orm:hibernate-core']) {
    assert.notEqual((await effective(config, dependency('gradle', name, 'minor'))).groupName, 'q4j');
  }
});

test('dependency commits use the deps type scoped by manager', { timeout: 30_000 }, async () => {
  const config = await resolve(['gradle/default', 'docker/default', 'npm/default', 'github-actions/default']);
  for (const [manager, name] of [
    ['github-actions', 'actions/checkout'],
    ['dockerfile', 'postgres'],
    ['gradle', 'org.hibernate.orm:hibernate-core'],
    ['npm', 'react'],
  ]) {
    const effectiveConfig = await effective(config, dependency(manager, name, 'minor'));
    assert.equal(effectiveConfig.semanticCommitType, 'deps');
    assert.equal(effectiveConfig.semanticCommitScope, '{{manager}}');
  }
});

test('custom regex dependency commits are scoped by lowercase dependency name', { timeout: 30_000 }, async () => {
  const config = await resolve(['github-actions/default']);
  for (const [name, scope] of [
    ['python', 'python'], ['pip', 'pip'], ['PyYAML', 'pyyaml'], ['renovate', 'renovate'],
    ['quokkify/ci-kit', 'ci-kit'], ['rhysd/actionlint', 'actionlint'],
    ['quokkify/compose-health-check-action', 'compose-health-check-action'],
  ]) {
    const result = await effective(config, dependency('custom.regex', name, 'minor'));
    const rendered = template.compile(result.semanticCommitScope, { ...result, depName: name });
    assert.equal(rendered, scope);
    assert.match(rendered, /^[a-z0-9][a-z0-9._-]*$/);
  }
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

// Opt-in presets below are appended after the presets a consumer already uses.
// Renovate's option defaults are merged in so that mergeable objects such as
// vulnerabilityAlerts and the group branch templates match a real run.
const optIn = ['presets/hardening/supply-chain.json', 'presets/grouping/coupled-stacks.json'];
const withDefaults = (config) => mergeChildConfig(getDefaultConfig(), config);
async function branchName(config, dep) {
  const result = await effective(config, dep);
  generateBranchName(result);
  return result.branchName;
}
const versioned = (manager, depName, updateType, newMajor, extra = {}) => dependency(manager, depName, updateType, {
  depNameSanitized: depName.replace(/[^a-z0-9]+/gi, '-').toLowerCase(),
  newMajor,
  newMinor: 0,
  ...extra,
});
// Builds the package rule exactly as Renovate's OSV integration does for a
// vulnerable dependency, then applies it after all configured package rules.
async function vulnerabilityFix(config, dep, { datasource, depVersion, fixedVersion }) {
  const rule = Object.create(Vulnerabilities.prototype).vulnerabilityToPackageRules({
    vulnerability: { id: 'GHSA-test-test-test', summary: 'Test advisory', details: 'Test advisory' },
    affected: {},
    packageName: dep.packageName,
    depVersion,
    fixedVersion,
    datasource,
    packageFileConfig: config,
  });
  return effective({ ...config, packageRules: [...config.packageRules, rule] },
    { ...dep, datasource, currentValue: depVersion, currentVersion: depVersion, newVersion: fixedVersion });
}

test('existing presets never pull in the opt-in hardening or grouping presets', { timeout: 60_000 }, async () => {
  for (const entry of ['base', 'gradle/default', 'gradle/service', 'gradle/q4j', 'docker/default', 'npm/default',
    'python/default', 'github-actions/default', 'migrations/javax-to-jakarta']) {
    await resolve([entry]);
    const files = requestedPresets.map(({ presetPath, presetName }) => `${presetPath}/${presetName}.json`);
    for (const file of optIn) assert.ok(!files.includes(file), `${entry} must not extend ${file}`);
  }
  for (const file of optIn) {
    const preset = JSON.parse(readFileSync(path.join(root, file), 'utf8'));
    assert.equal(preset.extends, undefined, `${file} must only add rules after the consumer's own presets`);
    assert.equal(preset.enabledManagers, undefined, `${file} must not replace enabledManagers`);
  }
});

const sensitive = [
  ['github-actions', 'actions/checkout', 'digest'],
  ['github-actions', 'actions/setup-java', 'minor'],
  ['github-actions', 'postgres', 'minor', { datasource: 'docker', depType: 'service' }],
  ['dockerfile', 'eclipse-temurin', 'minor', { datasource: 'docker' }],
  ['docker-compose', 'postgres', 'patch', { datasource: 'docker' }],
  ['dockerfile', 'python', 'digest', { datasource: 'docker' }],
  ['gradle', 'org.springframework.boot:org.springframework.boot.gradle.plugin', 'patch', { depType: 'plugin' }],
  ['maven', 'org.apache.maven.plugins:maven-surefire-plugin', 'minor', { depType: 'build' }],
  ['gradle-wrapper', 'gradle', 'minor'],
  ['custom.regex', 'rhysd/actionlint', 'patch'],
];
const libraries = [
  ['npm', 'react', 'patch'],
  ['npm', '@playwright/test', 'minor'],
  ['gradle', 'org.hibernate.orm:hibernate-core', 'patch', { depType: 'dependencies' }],
  ['pip_requirements', 'requests', 'minor', { datasource: 'pypi' }],
];

test('opt-in hardening stops automerge for execution-sensitive updates and keeps library automerge', { timeout: 120_000 }, async (t) => {
  for (const presets of [
    ['base', 'hardening/supply-chain'],
    ['gradle/default', 'docker/default', 'npm/default', 'github-actions/default', 'python/default', 'hardening/supply-chain'],
    ['gradle/service', 'docker/default', 'hardening/supply-chain'],
  ]) {
    await t.test(presets.join(' + '), { timeout: 30_000 }, async () => {
      const config = withDefaults(await resolve(presets));
      for (const [manager, name, update, extra] of sensitive) {
        const result = await effective(config, dependency(manager, name, update, extra));
        assert.equal(result.automerge, false, `${manager} ${name} ${update} must wait for review`);
        assert.equal(result.dependencyDashboardApproval, false, `${manager} ${name} ${update} PR must still open`);
        assert.equal(result.minimumReleaseAge, '3 days');
        manualMajor(await effective(config, dependency(manager, name, 'major', extra)));
      }
      for (const [manager, name, update, extra] of libraries) {
        safeNonMajor(await effective(config, dependency(manager, name, update, extra)));
        manualMajor(await effective(config, dependency(manager, name, 'major', extra)));
      }
      const lockfile = await effective(config, dependency('npm', 'lockfile', 'lockFileMaintenance'));
      assert.equal(lockfile.automerge, false, 'Lock-file maintenance must wait for review');
      assert.equal(lockfile.dependencyDashboardApproval, false, 'Lock-file maintenance PR must still open');
    });
  }
});

test('opt-in hardening must come after the presets it hardens', { timeout: 30_000 }, async () => {
  const misordered = await resolve(['hardening/supply-chain', 'docker/default']);
  const postgres = await effective(misordered, dependency('docker-compose', 'postgres', 'patch', { datasource: 'docker' }));
  assert.equal(postgres.automerge, true, 'A later docker/default rule re-enables automerge; document the order');
  const ordered = await resolve(['docker/default', 'hardening/supply-chain']);
  assert.equal((await effective(ordered, dependency('docker-compose', 'postgres', 'patch', { datasource: 'docker' }))).automerge, false);
});

// Renovate always processes vulnerability branches before all others (sortBranches),
// and the validator rejects prPriority inside vulnerabilityAlerts.
test('opt-in hardening opens vulnerability fixes immediately, unthrottled and without the release-age wait', { timeout: 60_000 }, async () => {
  const fixes = [
    [dependency('npm', 'lodash', 'patch'), { datasource: 'npm', depVersion: '4.17.20', fixedVersion: '4.17.21' }],
    [dependency('pip_requirements', 'djangorestframework', 'minor'), { datasource: 'pypi', depVersion: '3.15.2', fixedVersion: '3.16.0' }],
    [dependency('npm', 'next', 'major'), { datasource: 'npm', depVersion: '13.5.0', fixedVersion: '14.2.0' }],
    [dependency('github-actions', 'tj-actions/changed-files', 'minor'), { datasource: 'github-tags', depVersion: 'v45.0.7', fixedVersion: 'v46.0.1' }],
  ];
  const base = withDefaults(await resolve(['github-actions/default', 'python/default']));
  const baseFix = await vulnerabilityFix(base, ...fixes[0]);
  assert.equal(baseFix.isVulnerabilityAlert, true);
  assert.equal(baseFix.prCreation, 'approval', 'Base holds vulnerability PRs for approval today');
  assert.equal(baseFix.branchConcurrentLimit, 3, 'Base caps vulnerability branches at 3 today');

  const config = withDefaults(await resolve(['github-actions/default', 'python/default', 'hardening/supply-chain']));
  for (const [dep, vulnerability] of fixes) {
    const result = await vulnerabilityFix(config, dep, vulnerability);
    assert.equal(result.isVulnerabilityAlert, true, `${dep.depName} must match the vulnerability rule`);
    assert.equal(result.prCreation, 'immediate');
    assert.equal(result.dependencyDashboardApproval, false);
    assert.equal(result.minimumReleaseAge, null);
    assert.deepEqual(result.schedule, []);
    assert.equal(result.prConcurrentLimit, 0, '0 means no concurrent PR limit');
    assert.equal(result.branchConcurrentLimit, 0, '0 means no concurrent branch limit');
    assert.equal(result.groupName, null, 'A fix is never held back by a group');
    assert.deepEqual(result.labels, ['security']);
  }
  assert.equal((await vulnerabilityFix(config, ...fixes[2])).automerge, false, 'A major fix still needs review');
  assert.equal((await vulnerabilityFix(config, ...fixes[3])).automerge, false, 'An action fix still needs review');
});

test('opt-in grouping moves every ReportPortal image in one branch and keeps majors behind approval', { timeout: 30_000 }, async () => {
  const images = ['reportportal/service-api', 'reportportal/service-ui', 'reportportal/service-jobs'];
  const without = withDefaults(await resolve(['docker/default']));
  const split = new Set();
  for (const [index, image] of images.entries()) {
    split.add(await branchName(without, versioned('docker-compose', image, 'major', 5 + (index % 2), { datasource: 'docker' })));
  }
  assert.equal(split.size, images.length, 'Without the preset every image and hop gets its own branch');

  const config = withDefaults(await resolve(['docker/default', 'grouping/coupled-stacks']));
  const majors = new Set();
  for (const [index, image] of images.entries()) {
    const dep = versioned('docker-compose', image, 'major', 5 + (index % 2), { datasource: 'docker' });
    const result = await effective(config, dep);
    manualMajor(result);
    assert.equal(result.groupName, 'reportportal images');
    assert.equal(result.separateMultipleMajor, false);
    majors.add(await branchName(config, dep));
  }
  assert.deepEqual([...majors], ['renovate/major-reportportal-images']);
  const minors = new Set();
  for (const image of images) {
    const dep = versioned('dockerfile', image, 'minor', 5, { datasource: 'docker' });
    safeNonMajor(await effective(config, dep));
    minors.add(await branchName(config, dep));
  }
  assert.deepEqual([...minors], ['renovate/reportportal-images']);
  assert.equal((await effective(config, dependency('dockerfile', 'postgres', 'minor', { datasource: 'docker' }))).groupName,
    'postgres docker image', 'Other images keep their docker/default groups');
  const gradle = withDefaults(await resolve(['gradle/default', 'grouping/coupled-stacks']));
  assert.equal((await effective(gradle, dependency('gradle', 'com.epam.reportportal:agent-java-junit5', 'minor'))).enabled, false,
    'ReportPortal Gradle artifacts stay disabled');
});

test('opt-in grouping keeps the Django stack in one branch across all update types', { timeout: 30_000 }, async () => {
  const stack = [
    ['django', 'minor', 6], ['djangorestframework', 'major', 4],
    ['django-cors-headers', 'patch', 4], ['whitenoise', 'minor', 6],
  ];
  const pip = (name, update, major) => versioned('pip_requirements', name, update, major, { datasource: 'pypi' });
  const without = withDefaults(await resolve(['python/default']));
  assert.notEqual(await branchName(without, pip('django', 'minor', 6)),
    await branchName(without, pip('djangorestframework', 'major', 4)), 'python/default splits framework and companion');

  for (const presets of [['python/default', 'grouping/coupled-stacks'], ['base', 'grouping/coupled-stacks']]) {
    const config = withDefaults(await resolve(presets));
    const branches = new Set();
    for (const [name, update, major] of stack) {
      const result = await effective(config, pip(name, update, major));
      assert.equal(result.groupName, 'django stack');
      assert.equal(result.separateMajorMinor, false);
      if (update === 'major') manualMajor(result);
      branches.add(await branchName(config, pip(name, update, major)));
    }
    assert.deepEqual([...branches], ['renovate/django-stack'], presets.join(' + '));
    assert.notEqual((await effective(config, pip('requests', 'minor', 2))).groupName, 'django stack');
  }
});
