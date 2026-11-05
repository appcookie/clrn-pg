import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectRuff, compareInventory } from '../scripts/quality-check.mjs';

test('Ruff C901 blocks a new complex function even with noqa, while simple adapter tests remain legal', t => {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-quality-python-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'negative.py'), 'def complicated(value):  # noqa: C901\n'
    + Array.from({ length: 11 }, (_, i) => `    if value == ${i}:\n        return ${i}\n`).join(''));
  writeFileSync(join(directory, 'test_adapter.py'), 'def test_adapter():\n    assert {"route": "data"}["route"] == "data"\n');
  const { findings, measuredFiles } = collectRuff(directory);
  assert.equal(measuredFiles, 2);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule, 'C901');
  assert.equal(findings[0].file, 'negative.py');
  assert.equal(compareInventory(findings, []).added.length, 1);
});

test('Ruff ignores file-level suppression and fails on invalid Python syntax', t => {
  const directory = mkdtempSync(join(tmpdir(), 'clrn-quality-python-invalid-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'suppressed.py');
  writeFileSync(file, '# ruff: noqa\ndef complicated(value):\n'
    + Array.from({ length: 11 }, (_, i) => `    if value == ${i}:\n        return ${i}\n`).join(''));
  assert.equal(collectRuff(directory).findings[0].rule, 'C901');
  writeFileSync(file, 'def invalid(:\n');
  assert.throws(() => collectRuff(directory), /Python 解析失败/);
});
