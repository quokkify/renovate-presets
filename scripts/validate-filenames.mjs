import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Check the index: walking a macOS checkout cannot see colliding Git entries.
export function findCaseCollisions(paths) {
  const spellings = new Map();
  const collisions = new Set();
  for (const file of paths) {
    const parts = file.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      const key = prefix.normalize('NFC').toLowerCase();
      const previous = spellings.get(key);
      if (previous !== undefined && previous !== prefix) {
        collisions.add([previous, prefix].sort().join(' <-> '));
      } else {
        spellings.set(key, prefix);
      }
    }
  }
  return [...collisions].sort();
}

export function validateTrackedFilenames(cwd = process.cwd()) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  return findCaseCollisions(tracked);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const collisions = validateTrackedFilenames();
  if (collisions.length) {
    console.error(`Tracked filenames collide on case-insensitive filesystems:\n${collisions.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('Tracked filenames are portable across case-insensitive filesystems.');
  }
}
