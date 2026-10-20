/** 私人房配置与输入校验；真实建房/清理在 creation.spec.ts。 */
import { expect } from '@playwright/test';
import { register } from './shared/register';
import { diamond } from './shared/api';
const games = [
  { id:'texas_react_native', rule:'small-big-blind-title-text', text:/blind|小盲/i },
  { id:'zhajinhua', rule:'pin-san-zhang-rule-title-text', text:/rule|规则|規則/i },
  { id:'texas_six_plus', rule:'six-plus-rule-title-text', text:/rule|规则|規則/i },
];
for (const [index, game] of games.entries()) register('PRIVATE-002', index, 'signed-in', async ui => {
  const before = await diamond(ui.requiredSession()); await ui.tap('private-room-tab'); await ui.tap('create-game-button');
  await ui.visible('select-game-category-text'); await ui.tap(`game-type-button-${game.id}`); await ui.visible('base-create-room-screen');
  await ui.hasText(game.rule, game.text); const name = `IOS${game.id.slice(0,8)}`; await ui.fill('room-name-input', name); await ui.hasText('room-name-input', name);
  await ui.hasText('chip-item-text', /chip|score|记分牌|記分牌/i); await ui.hasText('price-text', '10'); await ui.tap('advanced-options-button');
  await ui.hasText('operation-duration-title-text', /30/); await ui.back(); await ui.visible('create-game-button'); await ui.count(/^private-room-[0-9a-f-]{36}$/, 0);
  expect(await diamond(ui.requiredSession())).toBe(before);
});
register('PRIVATE-004', 0, 'signed-in', async ui => {
  await ui.tap('private-room-tab'); await ui.enabled('join-game-button', false);
  await ui.fill('personal-room-smooth-pin-code-input','12345678'); await ui.enabled('join-game-button', false);
  await ui.fill('personal-room-smooth-pin-code-input','123456789'); await ui.enabled('join-game-button', true);
  await ui.fill('personal-room-smooth-pin-code-input',''); await ui.hasText('personal-room-smooth-pin-code-input','');
  await ui.fill('personal-room-smooth-pin-code-input','abc'); await ui.hasText('personal-room-smooth-pin-code-input',''); await ui.enabled('join-game-button', false);
});
for (const [index, game] of games.entries()) register('PRIVATE-005', index, 'signed-in', async ui => {
  await ui.tap('private-room-tab'); await ui.hasText('copy-house-number-button', /\d{9}/);
  if (!(await ui.nodes('select-game-category-text')).length) await ui.tap('create-game-button');
  await ui.tap(`game-type-button-${game.id}`); await ui.absent('select-game-category-text'); await ui.visible('base-create-room-screen');
  const original = await ui.checkState('audit-buy-in-switch'); expect(typeof original).toBe('boolean');
  await ui.tap('audit-buy-in-switch'); await ui.checked('audit-buy-in-switch', !original); await ui.tap('audit-buy-in-switch'); await ui.checked('audit-buy-in-switch', original!);
  await ui.back(); await ui.visible('create-game-button'); await ui.absent('base-create-room-screen');
});
