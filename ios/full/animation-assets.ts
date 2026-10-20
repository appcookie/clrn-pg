import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';

/**
 * 读取 WebP 的顶层 ANMF 块；拒绝仅凭字节中出现 ANMF 文本冒充真实动画帧。
 * @param bytes - 从已验证模拟器应用 原样取出的 WebP。
 */
export function animatedWebpFrames(bytes: Buffer): number {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP'
    || bytes.readUInt32LE(4) + 8 !== bytes.length) throw new Error('无效 WebP RIFF 长度或标记');
  let count = 0;
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) throw new Error('WebP 块头被截断');
    const size = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + size > bytes.length) throw new Error('WebP 动画帧被截断');
    if (bytes.toString('ascii', offset, offset + 4) === 'ANMF') count++;
    offset += 8 + size + (size % 2);
  }
  return count;
}

export const requiredAnimations = [
  'fire/fire', 'victory/circle',
  ...['beer', 'flower', 'good', 'heart', 'tea', 'tomato', 'water'].map(name => `props/${name}`),
  ...['angry', 'cry', 'drink', 'handclap', 'puchi', 'smirk', 'titter'].map(name => `stickers/${name}`),
].sort();

/** 从已经校验 Release 散列的模拟器应用读取真实动画素材。 */
export function packagedAnimations(application: string): Record<string, { sha256: string; frames: number }> {
  const directory = path.join(application, 'assets/src/board_game_react_native/frames/image');
  const entries = readdirSync(directory, { recursive: true }).map(String).filter(name => name.endsWith('.webp')).sort();
  expect(entries.map(name => name.replace(/\.webp$/, ''))).toEqual(requiredAnimations);
  return Object.fromEntries(entries.map(name => {
    const bytes = readFileSync(path.join(directory, name));
    const frames = animatedWebpFrames(bytes);
    expect(frames, `${name} 必须保持真实逐帧动画`).toBeGreaterThan(1);
    return [name.replace(/\.webp$/, ''), { sha256: createHash('sha256').update(bytes).digest('hex'), frames }];
  }));
}
