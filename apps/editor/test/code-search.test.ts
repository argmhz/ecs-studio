import assert from 'node:assert/strict';
import test from 'node:test';
import { findInProjectScripts } from '../src/code-search.ts';

test('project script search returns case-insensitive file and line results', () => {
  assert.deepEqual(findInProjectScripts({ 'scripts/a.ts': 'const speed = 1;\nupdate(speed);', 'scripts/b.js': 'const SPEED = 2;' }, 'speed'), [
    { path: 'scripts/a.ts', line: 1, column: 7, snippet: 'const speed = 1;' },
    { path: 'scripts/a.ts', line: 2, column: 8, snippet: 'update(speed);' },
    { path: 'scripts/b.js', line: 1, column: 7, snippet: 'const SPEED = 2;' },
  ]);
  assert.deepEqual(findInProjectScripts({ 'scripts/a.ts': 'speed' }, '  '), []);
});
