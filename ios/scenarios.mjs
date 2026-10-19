// 首批真实游客页面；入口和就绪标识与 clrn-az 的共享场景一致。
export const scenarios = [
  { name: 'hall', tab: 'hall-tab', ready: 'hall-sign-in-button' },
  { name: 'guest-message', tab: 'message-tab', ready: 'not-sign-in-container' },
  { name: 'guest-private-room', tab: 'private-room-tab', ready: 'guest-private-room-empty-state' },
  { name: 'guest-club', tab: 'club-tab', ready: 'club-tab-screen' },
  { name: 'guest-me', tab: 'settings-tab', ready: 'after-sign-in-see-asset-text' },
  { name: 'login', tab: 'settings-tab', clicks: ['sign-in-button'], ready: 'username-or-email-sign-in-button' },
];

export function selectScenarios(filter = '') {
  if (!filter) return scenarios;
  const expression = new RegExp(filter);
  const selected = scenarios.filter(scenario => expression.test(scenario.name));
  if (!selected.length) throw new Error(`没有匹配的 iOS 页面：${filter}`);
  return selected;
}
