// 每个共享页面均执行真实导航、就绪断言和 iOS 独立截图。
import { test, locale } from '../fixtures';
import { iosScenarios } from '../scenarios';
import { navigateScenario, signIn } from '../navigation';
import { compareScreenshot } from '../device';
import { screenshotMasks } from '../screenshot';
import { assertRoomAdvancedOptions } from '../room-advanced';
import { safeNativeTree } from '../diagnostics';
for (const scenario of iosScenarios(locale, process.env.IOS_GROUP)
  .filter(item => item.pageLabel !== 'signed_in_club_rooms_populated')) {
  test(`${locale} / ${scenario.group} / ${scenario.pageLabel}`, async ({ application }, testInfo) => {
    // Auth navigation includes several independent XCTest layout and keyboard queries.
    if (scenario.pageLabel === 'login_forgot_password') testInfo.setTimeout(300_000);
    if (scenario.signIn && !application.signedIn) {
      await signIn(application.device);
      application.signedIn = true;
    }
    const { backgroundBanner, readySnapshot } = await navigateScenario(application.device, scenario);
    if (/^signed_in_create_room_advanced_(texas|six_plus)$/.test(scenario.pageLabel)) {
      const nodes = await application.device.nodes();
      assertRoomAdvancedOptions(nodes, application.device.screenSize);
      await testInfo.attach('room-advanced-layout', {
        body: JSON.stringify(safeNativeTree(nodes)), contentType: 'application/json',
      });
    }
    const masks = await screenshotMasks(application.device, scenario, backgroundBanner, readySnapshot);
    // Run 42390319854: XCTest omitted this WebView's body while the same
    // run's Simulator capture retained it and passed the reviewed baseline.
    const takeScreenshot = locale === 'zh-Hans' && scenario.pageLabel === 'login_user_agreement'
      ? () => application.device.nativeScreenshot() : undefined;
    await compareScreenshot(application.device, `${locale}-${scenario.pageLabel.replaceAll('_', '-')}`, testInfo, masks,
      undefined, takeScreenshot);
  });
}
