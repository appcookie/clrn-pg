/** 实际钱包响应、币种与原生可见列表一致，不通过截图或空容器代替业务验证。 */
import { expect } from '@playwright/test';
import { register } from './shared/register';
import { balances, diamond, success } from './shared/api';
import { statements, expectStatements } from './shared/statements';
register('SETTINGS-003',0,'signed-in',async ui=>{
  await ui.settings('mall'); await ui.visible('diamond-goods-list'); await ui.hasText('product-amount-0',/\d/); await ui.hasText('product-price-0',/\d/);
  for(const currency of ['coin','diamond'] as const){
    const response=await ui.network.waitForResponse({method:'GET',path:`/v11/wallet/${ui.requiredSession().userId}/currency/${currency}/statement`},()=>ui.tap(currency==='coin'?'currency-transaction-record-button':'currency_transaction_top_tab_bar_diamond'));
    await expectStatements(ui,currency==='coin'?'coin-transaction-record-view':'account-security-items-list',statements(response,currency));
  }
  await ui.back(); await ui.visible('diamond-goods-list'); await ui.tap('purchase-history-button'); await ui.hasText('purchase-history-empty-text',/no|没有|沒有/i);
  await ui.back(); await ui.visible('currency-transaction-record-button'); await ui.back(); await ui.tap('gift-card');
  await ui.hasText('available-gift-card',/empty|no|空/i); await ui.tap('expired-gift-card-tab'); await ui.hasText('expired-gift-card',/empty|no|空/i);
  await ui.tap('available-gift-card-tab'); await ui.hasText('available-gift-card',/empty|no|空/i); await ui.tap('exchange-gift-card-button');
  await ui.hasText('gift-card-input',''); await ui.visible('exchange-button'); await ui.back(); await ui.visible('personal-gift-card-screen-container');
});
register('SETTINGS-010',0,'signed-in',async ui=>{
  const response=await ui.network.waitForResponse({method:'PUT',path:`/v10/wallet/${ui.requiredSession().userId}`},()=>ui.tap('settings-tab'));
  const result=success(response); const coin=result.currencies.find((asset:any)=>asset.code==='coin'); if(!coin)throw new Error('钱包响应缺少金币');
  await ui.hasText('coin-balance-text',String(coin.balance)); await ui.tap('coin-button'); await ui.hasText('mall-coin-balance-text',String(coin.balance));
  // 不继承 Web 已知失败标记，iOS 默认金币分类不正确时真实失败。
  await ui.visible({text:/^(Exchange coins|Exchange Coins|兑换金币|兌換金幣)$/}); await ui.absent('diamond-goods-list');
});
register('SETTINGS-011',0,'signed-in',async ui=>{
  await ui.settings('mall'); const coins={text:/^(Exchange coins|Exchange Coins|兑换金币|兌換金幣)$/};
  await ui.tap('mall-tab-bar-Coin'); await ui.visible(coins); await ui.visible({text:/^[\d,]+\s*(coins|枚金币|枚金幣)$/i}); await ui.absent('diamond-goods-list');
  await ui.tap('mall-tab-bar-Diamond'); await ui.absent(coins); await ui.visible('diamond-goods-list'); await ui.hasText('product-price-0',/\d/);
  await ui.tap('mall-tab-bar-Coin'); await ui.visible(coins);
});
register('SETTINGS-012',0,'signed-in',async ui=>{
  await ui.settings('mall'); const prefix=`/v11/wallet/${ui.requiredSession().userId}/currency/`;
  const coin=statements(await ui.network.waitForResponse({method:'GET',path:`${prefix}coin/statement`},()=>ui.tap('currency-transaction-record-button')),'coin');
  await expectStatements(ui,'coin-transaction-record-view',coin);
  const diamonds=statements(await ui.network.waitForResponse({method:'GET',path:`${prefix}diamond/statement`},()=>ui.tap('currency_transaction_top_tab_bar_diamond')),'diamond');
  await ui.absent('coin-transaction-record-view'); await expectStatements(ui,'account-security-items-list',diamonds);
  await ui.tap('currency_transaction_top_tab_bar_coin'); await expectStatements(ui,'coin-transaction-record-view',coin); await ui.absent('account-security-items-list');
});
register('SLOT-001',0,'signed-in',async ui=>{
  const before=await diamond(ui.requiredSession());
  for(let visit=0;visit<2;visit++){
    await ui.tap('slot-banner'); await ui.visible('slot-machine-view'); await ui.hasText('energy-bar-text',/^\d+\s*\/\s*\d+$/);
    for(const currency of ['coin','diamond','energy'])await ui.hasText(`prize_${currency}_text_animation_text`,'0');
    await ui.visible('spin-button'); await ui.tap('close-button'); await ui.absent('slot-machine-view'); await ui.visible('hall-auth-state-signed-in');
  }
  expect(await diamond(ui.requiredSession())).toBe(before);
});
