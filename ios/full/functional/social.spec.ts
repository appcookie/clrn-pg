/** 俱乐部列表、表单边界及消息标签实际状态。 */
import { expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { register } from './shared/register';
import { success } from './shared/api';
register('CLUB-003', 0, 'signed-in', async ui => {
  await ui.tap('club-tab'); await ui.visible('club-tab-screen'); await ui.tap('club_tab_room'); await ui.visible('club-tab-screen');
  await ui.tap('club_tab_my_club'); await ui.visible('club-list-screen'); await ui.tap('show-more-button'); await ui.visible('club-more-popup');
  await ui.tap('search-club-button'); await ui.absent('club-more-popup');
  const keyword = `IOS${randomUUID().replaceAll('-','')}`; const response = await ui.submitSearch(keyword);
  expect(new URL(response.url).searchParams.get('keyword')).toBe(keyword); expect(success(response)).toEqual([]);
  await ui.hasText('club-search-input',keyword); await ui.fill('club-search-input',''); await ui.hasText('club-search-input','');
  await ui.tap('club-search-back-button'); await ui.visible('club-tab-screen'); await ui.tap('hall-tab'); await ui.visible('hall-auth-state-signed-in');
});
register('CLUB-006', 0, 'signed-in', async ui => {
  await ui.settings('create-club'); const submit='edit-club-header-right-complete';
  await ui.fill('edit-club-profile-input-name','IOS cancel'); await ui.fill('edit-club-profile-input-region','Test area'); await ui.enabled(submit,true);
  await ui.fill('edit-club-profile-input-region','   '); await ui.enabled(submit,false);
  await ui.fill('edit-club-profile-input-region','Test area'); await ui.enabled(submit,true);
  await ui.fill('edit-club-profile-input-name',''); await ui.enabled(submit,false); await ui.back(); await ui.visible('settings-screen');
});
register('MESSAGE-001', 0, 'signed-in', async ui => {
  await ui.tap('message-tab'); await ui.visible('message-top-title');
  for (const [kind,screen,empty] of [['club','club-notification-screen','no-notification-text'],['buy-in','game-buy-in-application-list-screen','empty-page-text'],['system','system-notification-screen-root','no-notification-text']]) {
    await ui.tap(`message-notification-item-${kind}`); await ui.visible(screen); await ui.hasText(empty,/no |all |没有|沒有|全部|暂无|暫無/i);
    await ui.back(); await ui.visible('message-top-title'); await ui.visible(`message-notification-item-${kind}`);
  }
  await ui.settings('club-notifications'); await ui.hasText('no-notification-text',/club|俱乐部|俱樂部/i); await ui.back(); await ui.visible('club-notifications');
});
register('MESSAGE-002', 0, 'signed-in', async ui => {
  await ui.tap('message-tab'); await ui.tap('message-notification-item-buy-in');
  const pending={text:/^(Pending|Unprocessed|未处理|未處理)$/i}; const processed={text:/^(Processed|已处理|已處理)$/i};
  await ui.selected(pending,true); await ui.tap(processed); await ui.selected(processed,true); await ui.selected(pending,false);
  await ui.tap(pending); await ui.selected(pending,true); await ui.selected(processed,false); await ui.back(); await ui.visible('message-notification-item-buy-in');
});
