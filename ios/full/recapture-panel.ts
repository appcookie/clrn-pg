import type { TestInfo } from '@playwright/test';

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
    const staged = {
      outputPath: (...segments: string[]) => info.outputPath(...segments),
      attach: async (name: string, options: Attachment['options']) => {
        attachments.push({ name, options });
      },
    } as TestInfo;
    const flush = async (suffix: string) => {
      for (const { name, options } of attachments) await info.attach(`${name}${suffix}`, options);
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
