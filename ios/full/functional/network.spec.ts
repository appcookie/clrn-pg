/** 精确故障注入后的实际错误、重试及真实后端恢复；不会把 mock 成功当作业务通过。 */
import { expect } from '@playwright/test';
import { nativeTest } from './shared/register';
import { success } from './shared/api';
const source='kevinanew/clrn@3974319d1c72a964dad3d2c8d5862fbd255cc03b:e2e/network-resilience.spec.ts';
nativeTest('network','NETWORK-001 大厅超时与真实重试恢复','guest',async ui=>{
  try{
    await ui.proxy.inject('hall-timeout');await ui.device.restart();await ui.hall();await ui.visible('hall-api-error-alert');await ui.visible('hall-api-retry-button');await ui.visible('hall-screen');
    expect((await ui.proxy.status()).interceptedRequests).toBeGreaterThan(0);await ui.proxy.clear();
    const response=await ui.network.waitForResponse({path:'/public/v1/hall_matching/available.json'},()=>ui.tap('hall-api-retry-button'));
    success(response);expect(response.mocked).toBe(false);await ui.absent('hall-api-error-alert');await ui.visible('match-game-item-texas_holdem-tourists');
    const bet=await ui.within('match-game-item-texas_holdem-tourists','match-game-bet-info');expect(bet.length).toBe(1);expect(bet[0].text).toMatch(/^\d+\s*\/\s*\d+$/);
  }finally{await ui.proxy.clear();}
},source);
nativeTest('network','NETWORK-002 登录失败退出 loading 并提示','guest',async ui=>{
  try{
    await ui.proxy.inject('login-failure');await ui.loginForm();await ui.fill('username-input','weaknetwork');await ui.fill('password-input','weaknetwork');await ui.tap('sign-in-button');
    await ui.visible('username-sign-in-error-alert');await ui.hasText('sign-in-button',/sign|log|登录|登入/i);await ui.absent({clazz:'XCUIElementTypeActivityIndicator'});
    expect((await ui.proxy.status()).interceptedRequests).toBeGreaterThan(0);
  }finally{await ui.proxy.clear();}
},source);
nativeTest('network','NETWORK-003 俱乐部错误重试仍失败，解除故障后真实恢复','signed-in',async ui=>{
  try{
    await ui.proxy.inject('club-failure');await ui.tap('club-tab');await ui.visible('club-list-load-error');await ui.visible('club-list-retry-button');await ui.visible('club-tab-screen');
    const before=(await ui.proxy.status()).interceptedRequests;expect(before).toBeGreaterThan(0);await ui.tap('club-list-retry-button');
    await expect.poll(async()=>(await ui.proxy.status()).interceptedRequests).toBeGreaterThan(before);await ui.visible('club-list-load-error');await ui.visible('club-list-retry-button');
    await ui.proxy.clear();const response=await ui.network.waitForResponse({method:'GET',path:'/v10/club'},()=>ui.tap('club-list-retry-button'));
    expect(new URL(response.url).searchParams.get('user_id')).toBe(ui.requiredSession().userId);success(response);expect(response.mocked).toBe(false);await ui.absent('club-list-load-error');
  }finally{await ui.proxy.clear();}
},source);
