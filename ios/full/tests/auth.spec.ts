import { test } from '@playwright/test';
import { compareScreenshot, launchApplication, waitForHall } from '../device';
import { tap } from '../navigation';
import { captureFailure } from '../diagnostics';
import { withAndroidProxy } from '../proxy';

if ((process.env.IOS_LOCALE || 'en') === 'en' && ['all', 'guest'].includes(process.env.IOS_GROUP || 'all')) {
  test('iOS Staging 登录与找回密码页面视觉回归', async ({}, info) => {
    test.setTimeout(1_200_000);
    await withAndroidProxy(async () => {
      const device = await launchApplication();
      try {
        await waitForHall(device);
        await tap(device, 'settings-tab');
        await tap(device, 'sign-in-button');
        await device.wait({ res: 'username-or-email-sign-in-button' });
        await compareScreenshot(device, 'login-welcome', info);
        await tap(device, 'username-or-email-sign-in-button');
        await device.wait({ res: 'username-input' });
        await compareScreenshot(device, 'login-username', info);
        await tap(device, 'forget-password-button');
        await device.wait({ res: 'reset-password-by-email-button' });
        await compareScreenshot(device, 'forgot-password-method', info);
        await tap(device, 'reset-password-by-email-button');
        await device.wait({ res: 'email-address-input' });
        await compareScreenshot(device, 'forgot-password-email', info);
      } catch (error) { await captureFailure(device, info); throw error; }
      finally { await device.close(); }
    });
  });
}
