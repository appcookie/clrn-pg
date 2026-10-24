import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestInfo } from '@playwright/test';

/** Keep every diagnostic frame without embedding hundreds of MB of base64 in
 * report.json. Playwright copies path attachments into this test's output.
 * Reviewed baseline PNGs continue to use their strict inline evidence contract.
 */
export async function attachFrameEvidence(info: Pick<TestInfo, 'attach'>, name: string, bytes: Buffer) {
  const directory = await mkdtemp(join(tmpdir(), 'ios-frame-'));
  try {
    const file = join(directory, 'frame.png');
    await writeFile(file, bytes);
    await info.attach(name, { path: file, contentType: 'image/png' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
