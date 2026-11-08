import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { testFiles, toolFiles } from '../scripts/zhajinhua-complexity-scope.mjs';

const root = resolve(import.meta.dirname, '..');
const eslint = new ESLint({ cwd: root });
const branches = count => Array.from({ length: count }, (_, i) => `if (x === ${i}) return ${i};`).join('\n');
const source = complexity => `export function measured(x) { ${branches(complexity - 1)} }`;

async function lint(text, filePath) {
  const [result] = await eslint.lintText(text, { filePath });
  return result.messages;
}

const testPaths = [
  'ios/full/zhajinhua-accurate-bet.ts', 'ios/full/zhajinhua-bet-region.test.mjs',
  'ios/full/zhajinhua-card-region.ts', 'ios/full/zhajinhua-operation-region.test.mjs',
  'ios/full/zhajinhua-showdown-endpoint.ts', 'ios/full/zhajinhua-showdown.test.mjs',
  'ios/full/zhajinhua-showdown-support.ts', 'ios/full/zhajinhua-region-geometry.ts',
  'ios/full/zhajinhua-image-fixture.mjs', 'quality/zhajinhua-complexity.test.mjs',
];

for (const file of testPaths) {
  test(`${file}: test/support complexity 3 passes, 4 fails`, async () => {
    assert.deepEqual(await lint(source(3), file), []);
    const messages = await lint(source(4), file);
    assert.equal(messages.length, 1);
    assert.match(messages[0].message, /complexity of 4\. Maximum allowed is 3/);
  });
}

for (const file of toolFiles) {
  test(`${file}: tool complexity 6 passes, 7 fails`, async () => {
    assert.deepEqual(await lint(source(6), file), []);
    const messages = await lint(source(7), file);
    assert.equal(messages.length, 1);
    assert.match(messages[0].message, /complexity of 7\. Maximum allowed is 6/);
  });
}

const nestedSources = [
  `export function outer() { return [1].map(x => { ${branches(3)} }); }`,
  `export class Fixture { constructor(x) { ${branches(3)} } }`,
  `export class Fixture { method(x) { ${branches(3)} } }`,
  `export class Fixture { get value() { const x = 1; ${branches(3)} } }`,
  `export class Fixture { set value(x) { ${branches(3)} } }`,
];
for (const text of nestedSources) {
  test(`nested callbacks, constructors and accessors are counted: ${text.slice(0, 40)}`, async () => {
    const messages = await lint(text, 'ios/full/zhajinhua-showdown-support.ts');
    assert.equal(messages.length, 1);
    assert.match(messages[0].message, /complexity of 4\. Maximum allowed is 3/);
  });
}

for (const [passing, failing] of [
  ['function f(a=0,b=0) {}', 'function f(a=0,b=0,c=0) {}'],
  ['function f(x) { return x?.a?.b; }', 'function f(x) { return x?.a?.b?.c; }'],
  ['function f(x) { return x || x || x; }', 'function f(x) { return x || x || x || x; }'],
]) {
  test(`classic counting retains defaults, optional chains and short circuits: ${passing}`, async () => {
    assert.deepEqual(await lint(passing, testPaths[0]), []);
    assert.match((await lint(failing, testPaths[0]))[0].message, /complexity of 4\. Maximum allowed is 3/);
  });
}

function workspace(t, files) {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-zhajinhua-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, name)), { recursive: true });
    writeFileSync(join(directory, name), text);
  }
  return directory;
}

const invoke = directory => spawnSync(process.execPath,
  [join(root, 'scripts/check-zhajinhua-complexity.mjs'), directory], { encoding: 'utf8' });

test('the real entry accepts test 3/tool 6 and ignores unrelated legacy files', t => {
  const directory = workspace(t, { [testPaths[0]]: source(3), [toolFiles[0]]: source(6), 'unrelated.ts': source(20) });
  const result = invoke(directory);
  assert.equal(result.status, 0, result.stderr);
});

for (const [file, text, expected] of [
  [testPaths[0], source(4), /complexity of 4/],
  [toolFiles[0], source(7), /complexity of 7/],
  [testPaths[6], nestedSources[0], /complexity of 4/],
  [testPaths[0], 'export const broken: = ;', /Parsing error/],
  [testPaths[0], `/* eslint complexity: off */\n${source(4)}`, /noInlineConfig/],
  [testPaths[0], `// eslint-disable-next-line complexity\n${source(4)}`, /noInlineConfig/],
  [testPaths[0], `/* eslint-disable */\n${source(4)}`, /noInlineConfig/],
]) {
  test(`the executable rejects ${file}: ${expected}`, t => {
    const result = invoke(workspace(t, { [file]: text }));
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, expected);
  });
}

test('an empty scope cannot masquerade as a successful check', t => {
  const result = invoke(workspace(t, {}));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /没有扫描到文件/);
});

test('missing ESLint dependencies cause a nonzero executable exit', t => {
  const directory = workspace(t, { 'scripts/placeholder': '' });
  for (const file of toolFiles.slice(1)) copyFileSync(join(root, file), join(directory, file));
  const result = spawnSync(process.execPath, [join(directory, toolFiles[1])], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot find package 'eslint'/);
});

test('existing static and pre-commit entry points invoke this independent scope', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
  assert.match(pkg.scripts['check:static'], /^npm run check:zhajinhua &&/);
  assert.match(pkg.scripts.check, /check:static/);
  assert.match(readFileSync(join(root, '.pre-commit-config.yaml'), 'utf8'), /entry: npm run check:zhajinhua/);
  assert.ok(testFiles.includes('quality/zhajinhua-complexity*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}'));
});
