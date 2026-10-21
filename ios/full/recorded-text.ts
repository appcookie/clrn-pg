import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ScreenshotBounds } from './screenshot';

export type RecordedText = { text: string; confidence: number; bounds: ScreenshotBounds };
const run = promisify(execFile);

/** 对选出的原始关键帧执行本地OCR，保留文字和真实图片坐标用于验收诊断。 */
export async function recognizeRecordedText(frames: Buffer[]): Promise<RecordedText[][]> {
  if (process.platform !== 'darwin') throw new Error('原片文字识别需要macOS原生Vision');
  const directory = await mkdtemp(join(tmpdir(), 'ios-recorded-text-'));
  try {
    const files = frames.map((_, index) => join(directory, `${index}.png`));
    await Promise.all(files.map((file, index) => writeFile(file, frames[index])));
    const { stdout } = await run('xcrun', ['swift', fileURLToPath(new URL('./recognize-text.swift', import.meta.url)), ...files],
      { timeout: 240_000, maxBuffer: 4 * 1024 * 1024 });
    const results = stdout.trim().split('\n').map(line => JSON.parse(line));
    if (results.length !== frames.length || results.some(lines => !Array.isArray(lines) || lines.some(line =>
      typeof line.text !== 'string' || !Number.isFinite(line.confidence) || !line.bounds
      || !Object.values(line.bounds).every(value => typeof value === 'number' && Number.isFinite(value)))))
      throw new Error('原片文字识别结果缺失或无效');
    return results;
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** 每张选中图片都必须含本场景的实际可见提示；不能用其他位置的数字或连接提示代替。 */
export function assertRecordedToastText(lines: RecordedText[], expected: string, panel: ScreenshotBounds,
  screen: { width: number; height: number }) {
  if (lines.some(line => /connecting|connection\s*timeout/i.test(line.text))) throw new Error('提示关键帧含连接等待或超时');
  const text = lines.filter(line => {
    const x = (line.bounds.x + line.bounds.width / 2) * screen.width;
    const y = (line.bounds.y + line.bounds.height / 2) * screen.height;
    return line.confidence >= 0.3 && x >= panel.x && x < panel.x + panel.width && y >= panel.y && y < panel.y + panel.height;
  }).map(line => line.text).join(' ').normalize('NFKC').replace(/\s+/g, '');
  const wanted = expected.normalize('NFKC').replace(/\s+/g, '');
  const matches = /^\d+$/.test(wanted) ? new RegExp(`(?:^|\\D)${wanted}(?:\\D|$)`).test(text) : text.includes(wanted);
  if (!wanted || !matches) throw new Error(`提示关键帧必须实际显示预期文字：${expected}；识别为：${text}`);
}
