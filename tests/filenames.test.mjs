import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { findCaseCollisions, validateTrackedFilenames } from '../scripts/validate-filenames.mjs';

test('case validator detects file and directory spellings without flagging unique names', () => {
  assert.deepEqual(findCaseCollisions(['README.md', 'docs/readme.md', 'docs/api.md']), []);
  assert.deepEqual(findCaseCollisions(['.github/PULL_REQUEST_TEMPLATE.md', '.github/pull_request_template.md']),
    ['.github/PULL_REQUEST_TEMPLATE.md <-> .github/pull_request_template.md']);
  assert.deepEqual(findCaseCollisions(['Docs/a.md', 'docs/b.md']), ['Docs <-> docs']);
  assert.equal(findCaseCollisions(['caf\u00e9.md', 'cafe\u0301.md']).length, 1);
});

test('CLI rejects colliding index entries even when files do not exist in checkout', { timeout: 30_000 }, () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'renovate-filenames-'));
  const git = (args, options = {}) => execFileSync('git', args, { cwd, ...options });
  try {
    git(['init', '--quiet']);
    const blob = git(['hash-object', '-w', '--stdin'], { input: 'template\n', encoding: 'utf8' }).trim();
    for (const file of ['.github/PULL_REQUEST_TEMPLATE.md', '.github/pull_request_template.md']) {
      git(['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`]);
    }
    assert.equal(validateTrackedFilenames(cwd).length, 1);
    const cli = fileURLToPath(new URL('../scripts/validate-filenames.mjs', import.meta.url));
    const failed = spawnSync(process.execPath, [cli], { cwd, encoding: 'utf8' });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /PULL_REQUEST_TEMPLATE\.md <-> .github\/pull_request_template\.md/);
    git(['update-index', '--force-remove', '.github/PULL_REQUEST_TEMPLATE.md']);
    const passed = spawnSync(process.execPath, [cli], { cwd, encoding: 'utf8' });
    assert.equal(passed.status, 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
