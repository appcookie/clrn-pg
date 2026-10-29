import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { compareScreenshot, launchApplication, waitForHall } from '../device';
import { captureFailure } from '../diagnostics';
import { selectLanguage } from '../navigation';
import { withAndroidProxy } from '../proxy';

const locale = process.env.IOS_LOCALE || 'en';
if (['all', 'guest'].includes(process.env.IOS_GROUP || 'all')) {
  test(`${locale} launch_staging_notice full screen`, async ({}, info) => {
    test.setTimeout(1_200_000);
    await withAndroidProxy(async () => {
      const device = await launchApplication();
      try {
        await waitForHall(device);
        await selectLanguage(device, locale);
        await device.restart();
        await device.wait({ res: 'staging-confirmation-input' }, { timeout: 120000 });
        await device.wait({ res: 'staging-dialog-title' });
        await device.wait({ res: 'staging-production-button' });
        expect((await device.info({ res: 'confirm-button' })).enabled).toBe(false);
        const fullScreen = async () => {
          const bytes = await device.nativeScreenshot();
          const picture = PNG.sync.read(bytes);
          expect({ width: picture.width, height: picture.height }).toEqual(device.screenSize);
          return bytes;
        };
        const { width, height } = device.screenSize;
        // The iOS Home indicator changes with simulator appearance; it is outside the app canvas.
        const homeIndicator = { x: Math.floor(width * 0.31), y: height - 48,
          width: Math.ceil(width * 0.38), height: 32 };
        await compareScreenshot(device, `${locale}-launch-staging-notice`, info, {
          takeScreenshot: fullScreen, comparisonExclusions: [homeIndicator],
        });
      } catch (error) { await captureFailure(device, info); throw error; }
      finally { await device.close(); }
    });
  });
}
