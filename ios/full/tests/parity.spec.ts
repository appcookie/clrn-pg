// 每个共享页面均执行真实导航、就绪断言和 iOS 独立截图。
import { test, locale } from '../fixtures';
import { iosScenarios } from '../scenarios';
import { navigateScenario, signIn } from '../navigation';
import { compareScreenshot } from '../device';
import { screenshotMasks } from '../screenshot';
for (const scenario of iosScenarios(locale, process.env.IOS_GROUP)
  .filter(item => item.pageLabel !== 'signed_in_club_rooms_populated')) {
  test(`${locale} / ${scenario.group} / ${scenario.pageLabel}`, async ({ application }, testInfo) => {
    // 大厅需要真实滑到底并复查页脚；CI 的 XCTest 整树查询每次可耗时十秒。
    if (scenario.pageLabel === 'hall') test.setTimeout(300_000);
    // Auth navigation includes several independent XCTest layout and keyboard queries.
    if (scenario.pageLabel === 'login_forgot_password') testInfo.setTimeout(300_000);
    if (scenario.signIn && !application.signedIn) {
      await signIn(application.device);
      application.signedIn = true;
    }
    const { backgroundBanner, readySnapshot } = await navigateScenario(application.device, scenario);
    const masks = await screenshotMasks(application.device, scenario, backgroundBanner, readySnapshot);
    await compareScreenshot(application.device, `${locale}-${scenario.pageLabel.replaceAll('_', '-')}`, testInfo, masks);
  });
}
