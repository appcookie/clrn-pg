import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectEslint, collectDependencies, collectDuplicates, compareInventory, assertShrinking } from '../scripts/quality-check.mjs';

function workspace(t, files) {
  const container = mkdtempSync(join(tmpdir(), 'clrn-quality-negative-'));
  // The host keeps worktrees below .cache; absolute report paths must still scan.
  const directory = join(container, '.cache', 'worktree');
  t.after(() => rmSync(container, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), text);
  }
  return directory;
}

test('ESLint blocks complexity, nesting and AST network fabrication; data and exact adapter units remain legal', async t => {
  const directory = workspace(t, {
    'ordinary.spec.ts': `
      export function complicated(x: number) {
        ${Array.from({ length: 11 }, (_, i) => `if (x === ${i}) return ${i};`).join('\n')}
      }
      if (a) { if (b) { if (c) { if (d) { work(); } } } }
      page.route('**', handler);
      page['fulfill']({body:'fake'});
      page?.[\`routeFromHAR\`]('fake.har');
      const {fulfill: respond} = route; respond({body:'fake'});
      const intercept = page.route; intercept('**', handler);
      const responseAdapter = {fulfill: async (body) => body};
    `,
    'data.ts': `export const text = "page.route('**', handler)"; // route.fulfill({})\nexport const response = {route: 'country'};`,
    'ios/full/network-routes.test.mjs': `adapter.route('**', route => route.fulfill({body:'adapter unit'}));`,
    'ios/full/tests/new-adapter.spec.ts': `adapter.route('**', handler);`,
  });
  const { findings } = await collectEslint(directory);
  assert.equal(findings.filter(entry => entry.rule === 'complexity').length, 1);
  assert.equal(findings.filter(entry => entry.rule === 'max-depth').length, 1);
  assert.equal(findings.filter(entry => entry.rule === 'architecture/no-network-fabrication').length, 7);
  assert.ok(findings.every(entry => !entry.file.endsWith('network-routes.test.mjs') && entry.file !== 'data.ts'));
  assert.equal(compareInventory(findings, []).added.length, findings.length);
});

test('dependency-cruiser blocks cycles and direct/re-exported UI response imports; exact adapter tests remain legal', t => {
  const directory = workspace(t, {
    'cycle-a.ts': "import './cycle-b';",
    'cycle-b.ts': "import './cycle-a';",
    'ios/full/network-routes.ts': 'export const response = 1;',
    'ios/full/navigation.ts': "export {response} from './network-routes';",
    'ios/full/network-routes.test.mjs': "import './network-routes';",
    'ios/full/tests/new-adapter.spec.ts': "import '../network-routes';",
    'ios/full/types.ts': "import type {Response} from './network-routes';",
    'unresolved.ts': "import './missing-implementation';",
  });
  const { findings } = collectDependencies(directory);
  assert.equal(findings.filter(entry => entry.rule === 'no-circular').length, 1);
  assert.equal(findings.filter(entry => entry.rule === 'no-ui-response-implementation').length, 3);
  assert.equal(findings.filter(entry => entry.rule === 'no-unresolved').length, 1);
  assert.ok(findings.every(entry => !entry.from.endsWith('network-routes.test.mjs')));
});

test('ESLint fails on parse errors and inline rule suppression instead of reporting a clean scan', async t => {
  for (const source of ['export const invalid: = ;', '/* eslint complexity: off */\nexport const value = 1;']) {
    const directory = workspace(t, { 'ordinary.ts': source });
    await assert.rejects(() => collectEslint(directory), /Parsing error|noInlineConfig/);
  }
});

test('jscpd blocks new clones, including a third copy of historical code', t => {
  const original = Array.from({ length: 20 }, (_, i) => `export const value${i} = input${i} + offset${i};`).join('\n');
  const directory = workspace(t, { 'first.ts': original, 'second.ts': original });
  const { findings } = collectDuplicates(directory);
  assert.ok(findings.length > 0);
  assert.equal(compareInventory(findings, []).added.length, findings.length);
  writeFileSync(join(directory, 'third.ts'), original);
  const added = compareInventory(collectDuplicates(directory).findings, findings).added;
  assert.ok(added.some(entry => entry.locations.some(location => location.file === 'third.ts')));
  for (const extension of ['mts', 'cts', 'jsx', 'tsx']) {
    writeFileSync(join(directory, `first.${extension}`), original);
    writeFileSync(join(directory, `second.${extension}`), original);
  }
  const locations = collectDuplicates(directory).findings.flatMap(entry => entry.locations.map(location => location.file));
  assert.ok(['mts', 'cts', 'jsx', 'tsx'].every(extension => locations.includes(`second.${extension}`)));
});

test('migration inventory rejects added, relocated or modified exceptions and detects stale entries', () => {
  const entry = { tool: 'eslint', file: 'legacy.ts', line: 3, rule: 'complexity', anchor: 'source', reason: '历史函数待迁移' };
  assert.doesNotThrow(() => assertShrinking([], [entry]));
  assert.throws(() => assertShrinking([entry], []), /只能缩减/);
  assert.throws(() => assertShrinking([entry, entry], [entry]), /只能缩减/);
  assert.throws(() => assertShrinking([{ ...entry, line: 4 }], [entry]), /只能缩减/);
  assert.throws(() => assertShrinking([{ ...entry, anchor: 'changed' }], [entry]), /只能缩减/);
  assert.throws(() => assertShrinking([{ ...entry, reason: '' }], [entry]), /注明原因/);
  assert.equal(compareInventory([], [entry]).stale.length, 1);
});

test('jscpd suppression markers cannot conceal newly duplicated code', t => {
  const start = ['// jscpd', 'ignore-start'].join(':');
  const end = ['// jscpd', 'ignore-end'].join(':');
  const directory = workspace(t, { 'concealed.ts': `${start}\nexport const concealed = true;\n${end}` });
  assert.throws(() => collectDuplicates(directory), /禁止使用重复检查忽略指令/);
});
