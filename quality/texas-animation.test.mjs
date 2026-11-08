import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintTexasAnimation } from '../scripts/check-texas-animation.mjs';
import { texasAnimationTools } from './texas-animation-scope.mjs';

const gate = fileURLToPath(new URL('../scripts/check-texas-animation.mjs', import.meta.url));
function write(directory, name, source) {
  const path = join(directory, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}
function workspace(t, files) {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-texas-complexity-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const name of texasAnimationTools) write(directory, name, 'export {};');
  write(directory, 'quality/texas-animation.test.mjs', 'export {};');
  write(directory, 'ios/full/texas-action-region.ts', 'export {};');
  write(directory, 'ios/full/texas-animation-fixture.ts', 'export {};');
  for (const [name, source] of Object.entries(files)) write(directory, name, source);
  return directory;
}
function branches(complexity) {
  return Array.from({ length: complexity - 1 }, (_, index) => `if (value === ${index}) return ${index};`).join('\n');
}
function ordinaryFunction(complexity) {
  return `export function sample(value) { ${branches(complexity)} }`;
}
function runGate(directory, entry = gate) {
  return spawnSync(process.execPath, [entry, directory], { encoding: 'utf8' });
}
function assertBlocked(result, diagnostic) {
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, diagnostic);
}

for (const file of ['ios/full/texas-action-region.test.mjs', 'ios/full/texas-card-region.ts',
  'ios/full/texas-animation-new-helper.ts', 'ios/full/texas-hall.test.ts']) {
  test(`${file}: test/support 3 passes, 4 fails through the actual entry`, async t => {
    const directory = workspace(t, { [file]: ordinaryFunction(3) });
    assert.equal(runGate(directory).status, 0);
    write(directory, file, ordinaryFunction(4));
    const results = await lintTexasAnimation(directory);
    assert.equal(results.flatMap(result => result.messages).filter(message => message.ruleId === 'complexity').length, 1);
    assertBlocked(runGate(directory), /complexity of 4.*Maximum allowed is 3/);
  });
}
for (const file of texasAnimationTools) {
  test(`${file}: tool/root 6 passes, 7 fails`, t => {
    const directory = workspace(t, { 'ios/full/texas-action-region.ts': 'export {};', [file]: ordinaryFunction(6) });
    assert.equal(runGate(directory).status, 0);
    write(directory, file, ordinaryFunction(7));
    assertBlocked(runGate(directory), /complexity of 7.*Maximum allowed is 6/);
  });
}

const nestedCases = [
  `export const outer = () => [1].map(value => { ${branches(4)} });`,
  `export default class Sample { constructor(value) { ${branches(4)} } }`,
  `export default class Sample { method(value) { ${branches(4)} } }`,
  `export default class Sample { get value() { const value = 1; ${branches(4)} } }`,
  `export default class Sample { set value(value) { ${branches(4)} } }`,
  `export function defaults(a = 1, b = 2, c = 3) { return a + b + c; }`,
  `export const chains = value => value?.a?.b?.c;`,
  `export const shortCircuit = value => value && value.a || value.b || value.c;`,
];
for (const [index, source] of nestedCases.entries()) {
  test(`classic complexity covers nested callbacks, methods, defaults and expressions: ${index}`, t => {
    const directory = workspace(t, { 'ios/full/texas-animation-negative.ts': source });
    assertBlocked(runGate(directory), /complexity of 4.*Maximum allowed is 3/);
  });
}
for (const [name, source, diagnostic] of [
  ['parse error', 'export const broken: = ;', /Parsing error/],
  ['disable comment', `/* eslint-disable complexity */\n${ordinaryFunction(4)}`, /complexity of 4|noInlineConfig/],
  ['config comment even below limit', '/* eslint complexity: off */\nexport const value = 1;', /noInlineConfig/],
]) {
  test(`the entry fails closed on ${name}`, t => {
    const directory = workspace(t, { 'ios/full/texas-action-start.ts': source });
    assertBlocked(runGate(directory), diagnostic);
  });
}

test('missing ESLint dependency exits nonzero from an isolated copy of the entry', t => {
  const directory = workspace(t, { 'ios/full/texas-action-region.ts': 'export {};' });
  write(directory, 'scripts/check-texas-animation.mjs', readFileSync(gate, 'utf8'));
  assertBlocked(runGate(directory, resolve(directory, 'scripts/check-texas-animation.mjs')), /ERR_MODULE_NOT_FOUND.*eslint/s);
});

test('missing TypeScript parser exits nonzero', t => {
  const directory = workspace(t, { 'ios/full/texas-action-region.ts': 'export {};' });
  const config = resolve(directory, 'missing-parser.config.mjs');
  writeFileSync(config, "import parser from '@clrn/missing-eslint-parser'; export default [{languageOptions:{parser}}];");
  const cli = fileURLToPath(new URL('../node_modules/eslint/bin/eslint.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, '--config', config, directory], { encoding: 'utf8' });
  assertBlocked(result, /ERR_MODULE_NOT_FOUND.*missing-eslint-parser/s);
});
