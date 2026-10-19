/** Web AUTH-001..011 的真实 iOS 控件和会话回归。 */
import { expect } from '@playwright/test';
import { register } from './shared/register';
import { openNativeLegalDocument } from '../legal-document';
import { waitForCountryPicker } from '../country-picker';
import { accountStatus, balances, createAccount, credentials, request, success, type Session } from './shared/api';
register('AUTH-001', 0, 'guest', async ui => {
  await ui.loginForm(); await ui.fill('username-input', 'formcheck'); await ui.fill('password-input', 'formcheck123');
  await ui.hasText('username-input', 'formcheck'); await ui.secure('password-input');
});
register('AUTH-002', 0, 'signed-in', async ui => {
  const first = ui.requiredSession(); expect(await accountStatus(first)).toBe(200);
  const other = await ui.secondary();
  try {
    const second = await other.signIn(); expect(second.userId).toBe(first.userId);
    const observed = await ui.network.sessions();
    const deviceIds = observed.filter(s => s.userId === first.userId).map(s => s.deviceId);
    expect(new Set(deviceIds).size, '两个模拟器必须产生不同真实 deviceId').toBe(2);
    expect(await accountStatus(second)).toBe(200);
    await expect.poll(() => accountStatus(first), { timeout: 15_000 }).toBe(401);
    expect(await accountStatus(second)).toBe(200);
  } finally { await other.device.close(); }
});
register('AUTH-003', 0, 'signed-in', async ui => {
  const first = ui.requiredSession(); expect(await accountStatus(first)).toBe(200);
  const login = (await ui.network.captured({ method: 'POST', path: '/public/v10/user/login/username/password' })).at(-1);
  if (!login?.requestBody?.device_id) throw new Error('未观测到首次真实登录 device_id，不能证明同设备重登');
  // Native 已登录页面没有第二登录表单；第二次明确走相同设备的真实认证协议，避免退出提前注销旧会话。
  const response = await request(undefined, 'POST', '/public/v10/user/login/username/password', { ...login.requestBody, ...credentials() }, first.origin);
  const result = success(response);
  if (!result?.api_token?.access_token || !result.api_token.token_type) throw new Error('同设备重登没有返回真实 token');
  const second: Session = { ...first, userId: result.user_id, authorization: `${result.api_token.token_type} ${result.api_token.access_token}` };
  expect(second.userId).toBe(first.userId); expect(await accountStatus(second)).toBe(200);
  await expect.poll(() => accountStatus(first), { timeout: 15_000 }).toBe(401);
  expect(await accountStatus(second)).toBe(200);
});
register('AUTH-004', 0, 'guest', async ui => {
  await ui.openLogin(); await ui.tap('sign-in-button'); await ui.hasText('country-code-selector', /\+\d+/);
  await ui.tap('country-code-selector'); await waitForCountryPicker(ui.device); await ui.tap('country-code-list-item-852');
  await ui.contains('country-code-selector', '+852'); await ui.hasText('country-code-selector', /Hong Kong|中国香港|中國香港/i);
  await ui.fill('phone-number-input', '2025550123'); await ui.hasText('phone-number-input', '2025550123');
  await ui.visible('sms-request-code-button'); await ui.tap('password-sign-in-button'); await ui.secure('password-input');
  await ui.fill('password-input', 'formcheck123'); await ui.fill('phone-number-input', '2025550123'); await ui.hasText('phone-number-input', '2025550123');
});
for (const [index, method] of ['email', 'sms'].entries()) register('AUTH-005', index, 'guest', async ui => {
  await ui.loginForm(); await ui.tap('forget-password-button');
  await ui.visible('reset-password-by-email-button'); await ui.visible('reset-password-by-sms-button');
  await ui.tap(`reset-password-by-${method}-button`); await ui.hasText('greeting-text', /password|密码|密碼/i);
  const field = method === 'email' ? 'email-address-input' : 'phone-number-input'; const value = method === 'email' ? 'e2e-form@example.invalid' : '2025550123';
  await ui.fill(field, value); await ui.hasText(field, value); await ui.enabled('next-button', true);
  await ui.back(); await ui.visible('reset-password-by-email-button'); await ui.back(); await ui.visible('username-input'); await ui.secure('password-input');
});
for (const [index, document] of (['user-agreement', 'user-privacy'] as const).entries()) register('AUTH-006', index, 'guest', async ui => {
  await ui.openLogin(); await openNativeLegalDocument(ui.device, document, entry => ui.tap(entry));
  // Native WKWebView 的实际可访问正文。仅容器/标题存在不能证明文档加载成功。
  await expect.poll(async () => (await ui.device.nodes()).map(n => n.text).join('\n'), { timeout: 60_000 }).toMatch(/GoPlay360|来玩|來玩/i);
  await expect.poll(async () => (await ui.device.nodes()).map(n => n.text).join('\n')).toMatch(/privacy|隐私|隱私/i);
  await ui.back(); for (const id of ['username-or-email-sign-in-button', 'user-agreement-button', 'user-privacy-button']) await ui.visible(id);
});
register('AUTH-007', 0, 'guest', async ui => {
  const created = await createAccount(); const session = await ui.signIn(created);
  expect(session.userId).toBe(created.userId); expect((await balances(session)).diamond).toBe('0');
  await ui.tap('settings-tab'); await ui.contains('username-text', created.username); await ui.hasText('diamond-balance-text', '0');
  const mark = await ui.network.mark(); await ui.device.restart(); await ui.hall(); await ui.tap('settings-tab');
  await ui.contains('username-text', created.username); await ui.hasText('diamond-balance-text', '0'); expect(await accountStatus(session)).toBe(200);
  expect((await ui.network.captured({ after: mark, path: /\/user\/register\// })).length).toBe(0);
});
register('AUTH-008', 0, 'guest', async ui => {
  await ui.loginForm(); await ui.enabled('sign-in-button', false); await ui.fill('username-input', 'formcheck'); await ui.enabled('sign-in-button', false);
  await ui.fill('password-input', '123456'); await ui.enabled('sign-in-button', false);
  await ui.fill('password-input', 'formcheck123'); await ui.enabled('sign-in-button', true);
  await ui.fill('username-input', ''); await ui.enabled('sign-in-button', false); await ui.fill('username-input', 'formcheck'); await ui.enabled('sign-in-button', true);
  await ui.fill('password-input', ''); await ui.enabled('sign-in-button', false);
});
register('AUTH-008', 1, 'guest', async ui => {
  await ui.loginForm(); await ui.tap('forget-password-button'); await ui.tap('reset-password-by-email-button'); await ui.enabled('next-button', false);
  for (const value of ['bad-email', 'name@', '@example.invalid']) { await ui.fill('email-address-input', value); await ui.enabled('next-button', false); }
  await ui.fill('email-address-input', 'formcheck@example.invalid'); await ui.enabled('next-button', true);
  await ui.fill('email-address-input', ''); await ui.enabled('next-button', false);
});
register('AUTH-009', 0, 'guest', async ui => {
  for (const [id, label, greeting] of [['english','English','Welcome to GoPlay360'], ['zh-hant','繁體中文','歡迎來到來玩'], ['zh-hans','简体中文','欢迎来到来玩']]) {
    await ui.openLogin(); await ui.tap('switch-language-button'); await ui.tap(id);
    const option = await ui.node(id); expect(JSON.stringify(option.children || [])).toContain('checkmark-icon');
    await ui.tap('confirm-button'); await ui.device.restart(); await ui.hall(); await ui.openLogin();
    await ui.hasText('switch-language-label', label); await ui.hasText('greeting-text', greeting); await ui.tap('close-user-authentication-button');
  }
});
register('AUTH-010', 0, 'signed-in', async ui => {
  const session = ui.requiredSession(); await ui.settings('sign-out');
  await ui.tap({ text: /^(Cancel|取消)$/ }); await ui.contains('username-text', session.username);
  await ui.tap('sign-out'); await ui.tap({ text: /^(Sign out|Log out|退出登录|退出登錄)$/i });
  await ui.visible('after-sign-in-see-asset-text'); await ui.absent('username-text');
  await ui.device.restart(); await ui.hall(); await ui.absent('hall-auth-state-signed-in');
  await ui.tap('personal-house-create'); await ui.visible('username-or-email-sign-in-button');
});
register('AUTH-011', 0, 'guest', async ui => {
  await ui.loginForm(); await ui.fill('username-input', ' LAIWANVISUAL01 '); await ui.fill('password-input', 'validate1234');
  await ui.hasText('username-input', 'laiwanvisual01'); await ui.enabled('sign-in-button', true);
  await ui.fill('username-input', 'short'); await ui.enabled('sign-in-button', false); await ui.fill('username-input', 'sixchr'); await ui.enabled('sign-in-button', true);
  await ui.fill('password-input', '1234567890123456789'); await ui.enabled('sign-in-button', true);
  await ui.fill('password-input', '12345678901234567890'); await ui.enabled('sign-in-button', false);
});
