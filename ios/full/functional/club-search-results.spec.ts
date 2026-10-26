/** 使用原生输入和定向代理响应，验证俱乐部搜索命中后的卡片。 */
import { expect, test } from '@playwright/test';
import { nativeTest } from './shared/register';
import { success } from './shared/api';
import { waitForClubReady } from '../guest-club-ready';
import { compareScreenshot } from '../device';

type ClubSearchStatus = { active: boolean; searchRequests: number; detailsRequests: number };

nativeTest('functional', 'CLUB-007/1 俱乐部搜索命中固定结果并显示原生卡片', 'signed-in', async ui => {
  await ui.tap('club-tab');
  await waitForClubReady(ui.device, { signIn: true });
  await ui.tap('club_tab_room');
  await waitForClubReady(ui.device, { signIn: true });
  await ui.tap('club_tab_my_club');
  await ui.visible('club-list-screen');
  await ui.tap('show-more-button');
  await ui.visible('club-more-popup');
  await ui.tap('search-club-button');
  await ui.visible('club-search-input');

  // 初始化也会读取俱乐部资料，因此进入搜索页之后才启用固定响应。
  await ui.proxy.command('ios/club-search', { active: true });
  const response = await ui.submitSearch('VisualClubSearch');
  expect(new URL(response.url).searchParams.get('keyword'), '搜索请求应包含输入的关键字').toBe('VisualClubSearch');
  expect(success(response), '搜索响应应返回固定俱乐部编号').toEqual(['12f2cb6e-9045-4910-b58a-7d3903f56a39']);
  await ui.visible({ res: 'club-search-item-name', text: '搜索测试俱乐部' });
  await ui.visible('club-search-item-touchable');
  const status = await ui.proxy.command('ios/club-search') as ClubSearchStatus;
  expect(status.active).toBe(true);
  expect(status.searchRequests, '原生界面应发出一次搜索请求').toBe(1);
  expect(status.detailsRequests, '原生界面应读取一次命中俱乐部资料').toBe(1);
  await ui.device.hideKeyboard();
  await compareScreenshot(ui.device, 'en-signed-in-club-search-result', test.info());
}, '3ac209aa87c5eb802e90c8e06a413cfd2c740522:e2e/cases/club-007-search-mocked-result/test.spec.ts:1');
