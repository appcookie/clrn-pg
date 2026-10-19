/** 游客门禁、真实联合搜索、通知/商城/奖励快捷入口。 */
import { expect } from '@playwright/test';
import { register } from './shared/register';
import { success } from './shared/api';
register('HALL-001', 0, 'guest', async ui => {
  await ui.visible('hall-auth-state-signed-out'); await ui.tap('private-room-tab'); await ui.visible('guest-private-room-empty-state');
  await ui.tap('hall-tab'); await ui.visible('hall-screen'); await ui.visible('hall-sign-in-button');
});
for (const [index, [tab, screen]] of [['club-tab','club-tab-screen'], ['message-tab','message-screen']].entries()) register('HALL-002', index, 'guest', async ui => {
  await ui.tap(tab); await ui.visible(screen); await ui.tap('not-sign-in-container'); await ui.visible('username-or-email-sign-in-button');
});
register('HALL-002', 2, 'guest', async ui => {
  await ui.tap('settings-tab'); await ui.hasText('after-sign-in-see-asset-text', /sign.?in|log.?in|登录|登入/i);
  await ui.absent('coin-balance-text'); await ui.absent('diamond-balance-text'); await ui.tap('sign-in-button'); await ui.visible('username-or-email-sign-in-button');
});
register('HALL-002', 3, 'guest', async ui => {
  await ui.tap('hall-search-button'); await ui.hasText('pop-up-message-text', /sign.?in|log.?in|登录|登入/i);
  await ui.tap('cancel-button'); await ui.absent('confirm-pop-up-image-background'); await ui.visible('hall-auth-state-signed-out');
  await ui.tap('hall-search-button'); await ui.tap('confirm-button'); await ui.visible('username-or-email-sign-in-button');
});
for (const [index, game] of ['texas_holdem','zhajinhua'].entries()) register('HALL-002', index + 4, 'guest', async ui => {
  await ui.tap(`match-game-item-${game}-tourists`); await ui.visible('game-matching-sign-in-popup');
  await ui.hasText('pop-up-message-text', /sign.?in|log.?in|登录|登入/i);
  await ui.tap('close-button'); await ui.absent('game-matching-sign-in-popup'); await ui.visible('hall-auth-state-signed-out');
});
register('HALL-003', 0, 'signed-in', async ui => {
  await ui.tap('hall-search-button'); await ui.hasText('club-search-input', '');
  const before = await ui.network.mark(); const response = await ui.submitSearch('999999999');
  expect(new URL(response.url).searchParams.get('keyword')).toBe('999999999'); expect(success(response)).toEqual([]);
  const house = await ui.network.waitForResponse({ after: before, method: 'PUT', path: '/v10/house/number/999999999' });
  expect(house.method).toBe('PUT'); await ui.visible('club-search-results-empty'); await ui.hasText('club-search-input', '999999999');
  await ui.tap('club-search-back-button'); await ui.visible('hall-auth-state-signed-in'); await ui.visible('hall-shortcut-buttons-container');
});
register('HALL-003', 1, 'signed-in', async ui => {
  await ui.tap('notification-button'); await ui.visible('message-top-title'); for (const kind of ['club','buy-in','system']) await ui.visible(`message-notification-item-${kind}`);
  await ui.tap('hall-tab'); await ui.tap('store-button'); await ui.visible('diamond-goods-list'); await ui.hasText('product-price-0', /\d/);
  await ui.back(); await ui.visible('hall-auth-state-signed-in'); await ui.tap('invite-friend-button');
  await ui.hasText('download-url-text', 'https://www.shafayouxi.org'); await ui.hasText('url-text', 'https://h5.shafayouxi.org');
  await ui.visible('share-button'); await ui.back(); await ui.visible('hall-shortcut-buttons-container');
});
register('HALL-003', 2, 'signed-in', async ui => {
  await ui.tap('daily-bonus-button'); await ui.count('CheckInDateListItem', 7);
  const titles = await ui.nodes('CheckInDateListItem.title'); expect(titles.length).toBe(7);
  for (const [index, title] of titles.entries()) expect(title.text).toMatch(new RegExp(String(index + 1)));
  const rewards = await ui.nodes('CheckInDateListItem.rewardText'); expect(rewards.length).toBe(7); for (const reward of rewards) expect(reward.text).toMatch(/^\+\d+$/);
  await ui.visible('daily-bonus-check-in'); await ui.hasText('daily-bonus-check-in-instructions-body', /consecutive|连续|連續/i);
  await ui.hasText('daily-bonus-relief-instructions-body', /3/); await ui.back(); await ui.visible('hall-auth-state-signed-in');
});
for (const [index, entry] of ['slot-banner','daily-bonus-button','store-button','personal-house-create','personal-house-join'].entries()) register('HALL-004', index, 'guest', async ui => {
  await ui.tap(entry); await ui.visible('username-or-email-sign-in-button'); await ui.absent('hall-auth-state-signed-in');
  await ui.tap('close-user-authentication-button'); await ui.absent('username-or-email-sign-in-button');
  await ui.visible('hall-sign-in-button'); await ui.tap(entry); await ui.visible('username-or-email-sign-in-button');
});
register('HALL-005', 0, 'signed-in', async ui => {
  await ui.tap('hall-search-button'); await ui.visible('club-search-default-empty'); const keyword = `ios-empty-${Date.now()}`;
  const response = await ui.submitSearch(keyword); expect(new URL(response.url).searchParams.get('keyword')).toBe(keyword); success(response);
  await ui.visible('club-search-results-empty'); await ui.fill('club-search-input', ''); await ui.absent('club-search-results-empty'); await ui.visible('club-search-default-empty');
});
