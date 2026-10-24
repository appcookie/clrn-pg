import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { PNG } from 'pngjs';
import { comparePixels } from '../visual.mjs';

// Resolve baselineRoot in an isolated fixture, never overwrite reviewed PNGs.
const originalDirectory = process.cwd();
const originalMode = process.env.IOS_VISUAL_MODE;
const originalLocale = process.env.IOS_LOCALE;
const directory = mkdtempSync(join(tmpdir(), 'ios-visual-evidence-'));
process.chdir(directory);
process.env.IOS_VISUAL_MODE = 'compare';
process.env.IOS_LOCALE = 'en';
const { assertVisual } = await import('./device.ts');
const { baselinePath } = await import('./baseline-path.mjs');
after(() => {
  process.chdir(originalDirectory);
  if (originalMode === undefined) delete process.env.IOS_VISUAL_MODE;
  else process.env.IOS_VISUAL_MODE = originalMode;
  if (originalLocale === undefined) delete process.env.IOS_LOCALE;
  else process.env.IOS_LOCALE = originalLocale;
  rmSync(directory, { recursive: true, force: true });
});

function screenshot(color, width = 4) {
  const screenshot = new PNG({ width, height: 4 });
  for (let offset = 0; offset < screenshot.data.length; offset += 4) {
    screenshot.data.set([...color, 255], offset);
  }
  return PNG.sync.write(screenshot);
}
function fixture(name, expected) {
  const path = baselinePath(`${name}.png`);
  if (expected) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, expected);
  }
  const attachments = [];
  const testInfo = { attach: async (name, options) => attachments.push({ name, ...options }) };
  return { path, attachments, testInfo };
}

test('失败报告保留原截图契约，并附同次比较的 expected、actual 和 diff 原始字节', async () => {
  const name = 'en-login-visual-evidence';
  const expected = screenshot([255, 255, 255]);
  const actual = screenshot([0, 0, 0]);
  const { path, attachments, testInfo } = fixture(name, expected);
  const attach = testInfo.attach;
  testInfo.attach = async (name, options) => {
    await attach(name, options);
    if (name.endsWith('-expected')) writeFileSync(path, actual);
  };
  await assert.rejects(assertVisual(actual, name, testInfo), /变化比例 1/);
  assert.deepEqual(attachments.map(attachment => attachment.name), [
    `${name}.png`, `${name}.png-expected`, `${name}.png-actual`, `${name}.png-diff`,
  ]);
  assert.deepEqual(attachments.map(attachment => attachment.body), [
    actual, expected, actual, comparePixels(expected, actual, 12).diff,
  ]);
  assert.ok(attachments.every(attachment => attachment.contentType === 'image/png'));
});

test('图片尺寸不同仍失败，附两个原始输入，不伪造可比较的 diff', async () => {
  const name = 'en-login-dimension-evidence';
  const expected = screenshot([255, 255, 255]);
  const actual = screenshot([255, 255, 255], 5);
  const { attachments, testInfo } = fixture(name, expected);
  await assert.rejects(assertVisual(actual, `${name}.png`, testInfo), /变化比例 1/);
  assert.deepEqual(attachments.map(attachment => attachment.name), [
    `${name}.png`, `${name}.png-expected`, `${name}.png-actual`,
  ]);
  assert.deepEqual(attachments.map(attachment => attachment.body), [actual, expected, actual]);
});

test('缺少基准仍失败且标识实际图，不生成或冒充 expected', async () => {
  const name = 'en-login-missing-evidence';
  const actual = screenshot([0, 0, 0]);
  const { attachments, testInfo } = fixture(name);
  await assert.rejects(assertVisual(actual, name, testInfo), /缺少已审查基准/);
  assert.deepEqual(attachments.map(attachment => attachment.name), [`${name}.png`, `${name}.png-actual`]);
});

test('比较成功仍仅保留原截图附件，沿用颜色容差和排除区域', async () => {
  const expected = screenshot([255, 255, 255]);
  for (const [suffix, actual, exclusions] of [
    ['equal', expected, []],
    ['tolerance', screenshot([243, 243, 243]), []],
    ['exclusion', screenshot([0, 0, 0]), [{ x: 0, y: 0, width: 4, height: 4 }]],
  ]) {
    const name = `en-login-passing-evidence-${suffix}`;
    const { attachments, testInfo } = fixture(name, expected);
    await assertVisual(actual, name, testInfo, exclusions);
    assert.deepEqual(attachments.map(attachment => attachment.name), [`${name}.png`]);
    assert.deepEqual(attachments[0].body, actual);
  }
});
