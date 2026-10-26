/** 在独立应用会话中采集有牌局的俱乐部页面，避免资料留在空态场景。 */
import { test, locale } from '../fixtures';
import { iosScenarios } from '../scenarios';
import { compareScreenshot } from '../device';
import { signIn, navigateScenario } from '../navigation';
import { screenshotMasks } from '../screenshot';

const group = process.env.IOS_GROUP || 'all';
if (group === 'all' || group === 'social') {
  const scenario = iosScenarios(locale, group)
    .find(item => item.pageLabel === 'signed_in_club_rooms_populated');
  if (!scenario) throw new Error('缺少俱乐部有牌局的原生场景');
  test.use({ clubRoomsPopulated: true });

  test(`${locale} / ${scenario.group} / ${scenario.pageLabel}`, async ({ application }, testInfo) => {
    await signIn(application.device);
    const { backgroundBanner, readySnapshot } = await navigateScenario(application.device, scenario);
    const masks = await screenshotMasks(application.device, scenario, backgroundBanner, readySnapshot);
    await compareScreenshot(application.device, `${locale}-signed-in-club-rooms-populated`, testInfo, masks);
    const status = await application.proxy.command<{ requests: Record<string, number> }>('native/club-rooms');
    for (const path of ['/v10/club', '/v10/clubs', '/v2/building/rooms']) {
      if (!(status.requests[path] > 0)) {
        throw new Error(`有数据牌局场景未经过 mitmproxy：${path}`);
      }
    }
  });
}
