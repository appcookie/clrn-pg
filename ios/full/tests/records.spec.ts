import { screenPoint } from '../screen-geometry';
import { waitAbsent } from '../native-state';
import { test, expect } from '@playwright/test';
import { captureFailure } from '../diagnostics';
import { buildScenarios } from '../../../visual/scenarios';
import { RecordProxy } from '../../../visual/cases/game-record/proxy';
import { withAndroidProxy } from '../proxy';
import { launchApplication, waitForHall } from '../device';
import { navigateScenario, reveal, selectLanguage, signIn, tap } from '../navigation';
import { pressRecordControl, recordRow, recordSnapshots, reopenRecords, scrollRecords } from '../record-navigation';
import { recordStates } from '../record-states';
import { recordDeletion, legacyRecordEnd, v2RecordErrors } from '../record-extra';
import { scrollToEnd } from '../scroll-end';

const locale = process.env.IOS_LOCALE || 'en';
const enabled = ['all', 'records'].includes(process.env.IOS_GROUP || 'all');
for (const scenario of enabled ? buildScenarios({ VISUAL_LOCALES: locale, VISUAL_SCOPE: 'full', VISUAL_SUITE: 'app' })
  .filter(item => item.group === 'game-record' && item.viewport.label === 'mobile') : []) {
  test(`${locale} / game-record / ${scenario.pageLabel}`, async ({}, testInfo) => {
    test.setTimeout(900_000);
    const version = scenario.pageLabel.endsWith('legacy') ? 'legacy' : 'v2';
    await withAndroidProxy(async connection => {
      const proxy = new RecordProxy(connection);
      // 登录前先设置版本；代理在真实登录成功后绑定实际用户 ID，不伪造登录态。
      await proxy.configure('pending-login', version, 'empty');
      const device = await launchApplication();
      const { capture, complete } = recordSnapshots(device, scenario, testInfo, recordStates[version]);
      try {
        await waitForHall(device);
        await selectLanguage(device, locale);
        await signIn(device);
        await navigateScenario(device, { ...scenario, tabTestId: 'club-tab', visualReadySelector: '[data-testid="club-tab-screen"]' });
        await navigateScenario(device, scenario);
        await proxy.mode('empty', true);
        await tap(device, 'game-record');
        await device.wait({ res: version === 'legacy' ? 'progress-hud-activity-indicator' : 'loading-indicator' });
        await capture('loading');
        await proxy.release();
        await device.wait({ res: 'no-records-text' });
        await capture('empty');
        await proxy.mode('list');
        await reopenRecords(device);
        await device.wait(recordRow('Private Texas'));
        await capture('list');
        if (version === 'v2') {
          await proxy.mode('paged');
          await reopenRecords(device);
        }
        await scrollRecords(device, true);
        await reveal(device, recordRow('Long Room Name ABCDE'));
        if (version === 'v2') {
          await scrollToEnd(device, { res: 'my-game-record-list' }, { res: 'record-retained-days-text' });
        }
        await capture('list_bottom');
        await proxy.mode('list');
        await reopenRecords(device);
        const header = version === 'legacy' ? 'header-right-button' : 'navigation-bar-right-button';
        await tap(device, header);
        await device.wait({ res: 'record-sum-score-text', text: '0' });
        await capture('select_none');
        /**
         * 选择共享夹具中的一条战绩；旧版使用同一行的复选框位置。
         * @param key - 记录标识。
         * @param name - 房间名称。
         */
        const select = async (key: string, name: string) => {
          if (version === 'v2') { await tap(device, `select-record-visual-record-${key}-button`); return; }
          const { bounds } = await device.info(recordRow(name));
          const checkbox = await device.info({ res: 'select-status-button' });
          await device.input.tap({ x: checkbox.bounds.x + checkbox.bounds.width / 2, y: bounds.y + bounds.height / 2 });
        };
        await select('private', 'Private Texas');
        await device.wait({ res: 'record-sum-score-text', text: '+180' });
        await capture('select_win');
        await select('private', 'Private Texas');
        await select('club', 'Club Cards');
        await device.wait({ res: 'record-sum-score-text', text: '-90' });
        await capture('select_loss');
        await tap(device, 'game-record-list-select-all-button');
        await device.wait({ res: 'record-sum-score-text', text: '-1.2m' });
        await capture('select_all');
        await tap(device, 'game-record-list-select-all-button');
        await device.wait({ res: 'record-sum-score-text', text: '0' });
        await capture('select_clear');
        await tap(device, header);
        await waitAbsent(device, { res: 'record-sum-score-text' });
        await capture('select_cancel');
        await recordDeletion(device, capture);
        for (const [name, prefix] of [['Private Texas', 'private'], ['Club Cards', 'club']]) {
          await pressRecordControl(device, recordRow(name));
          await device.wait({ res: 'game-name-value-text', text: name });
          await device.wait({ res: 'detail-button' });
          await capture(`${prefix}_overview`);
          if (prefix === 'private') {
            await pressRecordControl(device, { res: 'player-nickname-text', text: 'Testing User' });
            await reveal(device, { res: version === 'legacy' ? 'player-name-text' : 'player-win-and-lose-relationship-list' }, true);
            await capture('private_relationship');
            await pressRecordControl(device, { res: 'player-nickname-text', text: 'Opponent' });
            await reveal(device, { res: version === 'legacy' ? 'player-name-text' : 'player-win-and-lose-relationship-list' }, true);
            await capture('private_relationship_switch');
            await pressRecordControl(device, { res: 'player-nickname-text', text: 'Opponent' });
            await waitAbsent(device, { res: version === 'legacy' ? 'player-name-text' : 'player-win-and-lose-relationship-list' });
            // 关系详情位于长页面底部；正常滚回概览后再进入详细战绩。
            for (let reset = 0; reset < 3; reset++) await device.input.swipe({ x1: screenPoint(device, 680, 400).x, y1: screenPoint(device, 680, 400).y, x2: screenPoint(device, 680, 1100).x, y2: screenPoint(device, 680, 1100).y, duration: Number('600') });
          }
          await tap(device, 'detail-button');
          await device.wait({ res: version === 'legacy' ? 'game-action-list-container' : 'review-board-action-list' });
          await capture(`${prefix}_actions`);
          await pressRecordControl(device, { res: /^(Game settlements|Settlement|牌局结算|牌局結算)$/i });
          await device.wait({ res: version === 'legacy' ? 'game-settlement-list' : 'review-board-settlement-list' });
          await capture(`${prefix}_settlement`);
          await device.input.press('Back');
          await device.wait({ res: 'detail-button' });
          if (prefix === 'private') {
            await pressRecordControl(device, version === 'legacy' ? { res: 'replay-tab-button' } : { text: /^(Replay|战绩回放|戰績回放)$/i });
            await device.wait({ res: 'game-replay-item' });
            await capture('replay_list');
          }
          // Android 系统返回会先回到 Overview 标签；页头返回才离开战绩详情。
          await tap(device, 'navigation-bar-back-image');
          await device.wait({ res: 'my-game-record-list' });
        }
        for (const [name, state, ready] of [
          ['Hall Texas', 'hall_overview', version === 'legacy' ? 'game-hall-record-view' : 'game-record-player-item'],
          ['Short Deck', 'short_deck_overview', 'detail-button'],
        ]) {
          await pressRecordControl(device, recordRow(name));
          await device.wait({ res: ready });
          await capture(state);
          await tap(device, 'navigation-bar-back-image');
          await device.wait({ res: 'my-game-record-list' });
        }
        await proxy.mode('no-hands');
        await reopenRecords(device);
        await pressRecordControl(device, recordRow('No Hands'));
        await device.wait({ res: version === 'legacy' ? 'no-hands-text' : 'no-hands-footer' });
        await capture('no_hands');
        await pressRecordControl(device, version === 'legacy' ? { res: 'replay-tab-button' } : { text: /^(Replay|战绩回放|戰績回放)$/i });
        await device.wait({ res: 'no-replay-text' });
        await capture('replay_empty');
        await tap(device, 'navigation-bar-back-image');
        await proxy.mode('list');
        await reopenRecords(device);
        if (version === 'legacy') await legacyRecordEnd(device, proxy, capture);
        else await v2RecordErrors(device, proxy, capture);
        expect(Object.values((await proxy.status()).recordRequests).reduce((total, count) => total + count, 0)).toBeGreaterThan(0);
        complete();
      } catch (error) {
        await captureFailure(device, testInfo);
        throw error;
      } finally { await proxy.release(); await device.close(); }
    }, true);
  });
}
