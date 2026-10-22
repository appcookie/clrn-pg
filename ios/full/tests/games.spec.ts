import { assertVisual } from '../device';
import { test as base, expect } from '@playwright/test';
import { buildScenarios } from '../../../visual/scenarios';
import { deletePrivateGameRoom, type RoomSession } from '../../../visual/cases/_shared/room';
import { withAndroidProxy } from '../proxy';
import { launchApplication, waitForHall } from '../device';
import { selectLanguage, signIn } from '../navigation';
import { captureFailure } from '../diagnostics';
import { createGameRoom, gameSession } from '../game-room';
import { captureGame } from '../game-capture';
import { gamePreGame } from '../game-pregame';
import { runTexasScenario } from '../texas-flows';
import { zhajinhuaGameplay } from '../zhajinhua-gameplay';
import type { ScreenshotMask } from '../screenshot';
import { maskScreenshot } from '../screenshot';

const test = base.extend<{ ownedRoom: { value: RoomSession | null } }>({
  /**
   * 独立于用例正文的收尾阶段，确保整例超时后仍清理已登记房间。
   * @param use - 将本轮房间登记容器交给用例，并等待框架进入收尾阶段。
   */
  ownedRoom: async ({}, use) => {
    const ownedRoom: { value: RoomSession | null } = { value: null };
    try { await use(ownedRoom); }
    finally { if (ownedRoom.value) await deletePrivateGameRoom(ownedRoom.value); }
  },
});

const locale = process.env.IOS_LOCALE || 'en';
for (const [suite, game] of [['texas', 'texas-holdem'], ['zhajinhua', 'zhajinhua']] as const) {
  const enabled = ['all', suite].includes(process.env.IOS_GROUP || 'all');
  const scenarios = enabled ? buildScenarios({ VISUAL_LOCALES: locale, VISUAL_SCOPE: 'full', VISUAL_SUITE: suite })
    .filter(scenario => scenario.viewport.label === 'mobile') : [];
  for (const scenario of scenarios) {
    const parts = locale !== 'en' ? ['all'] as const
      : ['signed_in_texas_game', 'signed_in_zhajinhua_game'].includes(scenario.pageLabel)
        ? ['table', 'effects'] as const
        : ['signed_in_texas_pre_game', 'signed_in_zhajinhua_pre_game'].includes(scenario.pageLabel)
          ? ['first', 'middle', 'second'] as const
            : ['all'] as const;
    for (const part of parts) {
      const states = part === 'first' ? scenario.snapshotStates!.slice(0, 3)
        : part === 'middle' ? scenario.snapshotStates!.slice(3, 7)
        : part === 'second' ? scenario.snapshotStates!.slice(7)
          : part === 'table' ? scenario.pageLabel === 'signed_in_texas_game'
            ? scenario.snapshotStates!.slice(0, 10) : scenario.snapshotStates!
            : part === 'effects' ? scenario.pageLabel === 'signed_in_texas_game'
              ? scenario.snapshotStates!.slice(10) : []
              : scenario.snapshotStates!;
      const label = part === 'all' ? scenario.pageLabel : `${scenario.pageLabel}_${part}`;
      test(`${locale} / ${suite} / ${label}`, async ({ ownedRoom }, testInfo) => {
        // 面板组 39780356637 已完成前 20 张截图，但在第 88 分钟进入退出确认时
        // 被原有 90 分钟总上限中断；给最后的真实菜单操作和失败诊断留足时间。
        // 其他场景仍保留原有上限。
        test.setTimeout(scenario.pageLabel === 'signed_in_texas_panels' ? 6_300_000 : 5_400_000);
        await withAndroidProxy(async proxy => {
          if (scenario.pageLabel === 'signed_in_texas_records_v2') await proxy.command('texas/records', { empty: true });
          const panelAnimation = locale === 'en' && scenario.pageLabel.endsWith('_pre_game');
          const gameAnimation = locale === 'en' && (scenario.pageLabel.endsWith('_game')
            || ['signed_in_texas_hall', 'signed_in_texas_panels', 'signed_in_texas_panel_variants']
              .includes(scenario.pageLabel));
          const device = await launchApplication({ gameDriver: true,
            enableSystemAnimations: panelAnimation || gameAnimation,
            microphonePermission: scenario.pageLabel === 'signed_in_texas_panels' });
          // XCTest game recordings repeatedly omit intermediate poses or have
          // backwards timestamps (39563456373, 39563462500, 39555894478).
          // Collect each game action once through the Simulator compositor;
          // preserve original timestamps, endpoints and target-motion gates.
          if (panelAnimation || gameAnimation) device.nativeVideoBackend = 'simctl';
          let room: RoomSession | null = null;
          let index = 0;
          try {
            await waitForHall(device);
            await selectLanguage(device, locale);
            await signIn(device);
            const hall = ['signed_in_texas_hall', 'signed_in_texas_hall_variants'].includes(scenario.pageLabel);
            const guest = scenario.pageLabel === 'signed_in_texas_table_states';
            if (hall || guest) await proxy.command('texas/view', { mode: hall ? 'hall' : 'guest' });
            await createGameRoom(device, proxy, game, created => { room = created; ownedRoom.value = created; },
              scenario.pageLabel === 'signed_in_texas_optional_pre_game', hall ? 'hall' : guest ? 'guest' : 'private');
            await testInfo.attach('created-room', { body: JSON.stringify({ roomId: room!.roomId }), contentType: 'application/json' });
            /**
             * 校验每个状态与 Web 清单的顺序一致。
             * @param state - 共用状态名。
             * @param masks - 已从真实输入框检测的光标区域。
             * @param triggerToast - 遮罩准备完成后才点击触发短时提示。
             */
            const capture = async (state: string, masks: ScreenshotMask[] = [], triggerToast?: () => Promise<string | void>, heldScreenshot?: Buffer) => {
              expect(state).toBe(states[index]);
              console.log(`IOS > ${suite} 截图状态 ${state}`);
              const transient = ['statistics_help', 'accurate_raise_minimum_error'].includes(state) ? 'toastText1'
                : ['prediction_result', 'prediction_loss', 'prediction_diamond'].includes(state) ? 'bet-next-hand-result-amount'
                  : state === 'level_up' ? 'level-up-title'
                    : state === 'remaining_cards' ? 'view-community-cards-countdown' : undefined;
              const expectedAlerts: Record<string, string> = {
                quit_confirm: 'common-alert-button-quit', alert_retry: 'common-alert-message',
                alert_insufficient_balance: 'common-alert-button-go_to_mall', alert_authentication_failed: 'common-alert-button-quit',
                delay_cooldown_alert: 'common-alert-message',
              };
              if (heldScreenshot) {
                const name = `${locale}-${scenario.pageLabel.replaceAll('_', '-')}-${state.replaceAll('_', '-')}`;
                await testInfo.attach(masks.length ? `${name}-original` : 'drag-held-original',
                  { body: heldScreenshot, contentType: 'image/png' });
                if (masks.length) await testInfo.attach(`${name}-masks`,
                  { body: JSON.stringify(masks), contentType: 'application/json' });
                await assertVisual(masks.length ? maskScreenshot(heldScreenshot, masks) : heldScreenshot,
                  `${name}.png`, testInfo);
                index++;
                return;
              }
              await captureGame(device, `${locale}-${scenario.pageLabel.replaceAll('_', '-')}-${state.replaceAll('_', '-')}`, testInfo,
                transient, expectedAlerts[state], masks, triggerToast);
              index++;
            };
            const { account } = await gameSession(proxy);
            expect(account).not.toBeNull();
            if (suite === 'texas' && scenario.pageLabel === 'signed_in_texas_pre_game') {
            await gamePreGame(device, game, capture, panelAnimation ? testInfo : undefined,
              part === 'first' || part === 'middle' || part === 'second' ? part : 'all');
            } else if (suite === 'texas') await runTexasScenario(scenario.pageLabel,
              { device, proxy, room: room!.roomId, self: account!.userId, capture,
              animationInfo: gameAnimation ? testInfo : undefined },
            part === 'table' || part === 'effects' ? part : 'all');
            else if (scenario.pageLabel.endsWith('_pre_game')) await gamePreGame(device, game, capture,
            panelAnimation ? testInfo : undefined,
            part === 'first' || part === 'middle' || part === 'second' ? part : 'all');
            else await zhajinhuaGameplay(device, proxy, room!.roomId, account!.userId, capture,
              gameAnimation ? testInfo : undefined, part === 'table' || part === 'effects' ? part : 'all');
            // 英文大厅的升级提示会自动消失，已由入场、倒计时和退场帧覆盖。
            const timedLevelUp = gameAnimation && scenario.pageLabel === 'signed_in_texas_hall';
            expect(index).toBe(states.length - Number(timedLevelUp));
          } catch (error) {
            await captureFailure(device, testInfo);
            throw error;
          } finally {
            try {
              // 即使创建按钮后的导航失败，也从本轮响应登记中找回房间并清理。
              room ||= (await gameSession(proxy)).room;
              ownedRoom.value ||= room;
            } finally { await device.close(); }
          }
        }, game);
      });
    }
  }
}
