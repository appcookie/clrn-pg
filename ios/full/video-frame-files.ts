import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

/** Preserve every decoded byte and frame order while yielding between disk
 * reads. The visual fixture HTTP server runs in this same Node process.
 */
export async function readRecordedFrameFiles(directory: string, expectedCount: number): Promise<Buffer[]> {
  const files = (await readdir(directory)).filter(file => file.endsWith('.png')).sort();
  if (files.length !== expectedCount) throw new Error('解码帧数与真实录屏时戳不一致。');
  const frames: Buffer[] = [];
  for (const file of files) frames.push(await readFile(path.join(directory, file)));
  return frames;
}
