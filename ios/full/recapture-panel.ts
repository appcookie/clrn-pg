import type { TestInfo } from '@playwright/test';
import { copyFile, rm } from 'node:fs/promises';

type Attachment = { name: string; options: Parameters<TestInfo['attach']>[1] };

/** Reopen a reversible panel only when its real recording missed the motion.
 * Keep missed movies and frames as diagnostics without allowing incomplete
 * phase images into the reviewed baseline export. The final capture still
 * fails if no actual slide appears in any original recording.
 */
export async function capturePanelWithMotionRecaptures(info: TestInfo,
  capture: (info: TestInfo) => Promise<void>, reset: () => Promise<void>,
  isMissedMotion: (error: unknown) => boolean): Promise<void> {
  for (let attempt = 1; attempt < 3; attempt++) {
    const attachments: Attachment[] = [];
    const stagedPaths: string[] = [];
    const staged = {
      outputPath: (...segments: string[]) => info.outputPath(...segments),
      attach: async (name: string, options: Attachment['options']) => {
        if (options?.path) {
          // Some frame helpers remove their temporary file immediately after
          // attach returns. Copy it while the source still exists.
          const stablePath = info.outputPath(`recapture-${attempt}-attachment-${attachments.length}`);
          await copyFile(options.path, stablePath);
          stagedPaths.push(stablePath);
          attachments.push({ name, options: { path: stablePath, contentType: options.contentType } });
        } else attachments.push({ name, options });
      },
    } as TestInfo;
    const flush = async (suffix: string) => {
      try {
        for (const { name, options } of attachments) await info.attach(`${name}${suffix}`, options);
      } finally {
        for (const path of stagedPaths) await rm(path, { force: true });
      }
    };
    try {
      await capture(staged);
    } catch (error) {
      if (!isMissedMotion(error)) {
        await flush('');
        throw error;
      }
      await flush(`-capture-${attempt}-missed-motion`);
      await reset();
      continue;
    }
    await flush('');
    return;
  }
  await capture(info);
}
