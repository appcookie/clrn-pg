/** 原生功能案例工具：实际点击/输入/重启，网络证据与 UI 结果分别断言。 */
import { expect } from '@playwright/test';
import { NetworkObserver } from '../../network-observer';
import { tap, reveal, dismissKeyboard } from '../../navigation';
import { launchApplication } from '../../device';
import type { NativeDevice } from '../../native-device';
import { accountStatus, credentials, success, type Credentials, type Session, type ApiResponse } from './api';
export type Selector = { res?: string | RegExp; text?: string | RegExp; clazz?: string | RegExp; enabled?: boolean; checked?: boolean };
export type NativeNode = { res: string; text: string; value?: string; clazz: string; enabled: boolean; visible?: boolean; checked?: boolean; secure?: boolean; selected?: boolean; attributes?: Record<string, unknown>; bounds: { x: number; y: number; width: number; height: number }; children?: NativeNode[] };
export const by = (value: string | RegExp | Selector): Selector => typeof value === 'string' || value instanceof RegExp ? { res: value } : value;
const matches = (value: string | undefined, wanted: string | RegExp | undefined) => wanted === undefined || (wanted instanceof RegExp ? wanted.test(value || '') : value === wanted);
export class NativeCase {
  readonly network: NetworkObserver;
  session?: Session;
  constructor(readonly device: NativeDevice, readonly proxy: any) { this.network = new NetworkObserver(proxy); }
  async node(id: string | RegExp | Selector): Promise<NativeNode> { await this.device.wait(by(id)); return await this.device.info(by(id)) as unknown as NativeNode; }
  async nodes(id: string | RegExp | Selector): Promise<NativeNode[]> {
    const selector = by(id); const list = await this.device.nodes() as unknown as NativeNode[];
    return list.filter(n => matches(n.res, selector.res) && matches(n.text, selector.text) && matches(n.clazz, selector.clazz)
      && (selector.checked === undefined || n.checked === selector.checked) && (selector.enabled === undefined || n.enabled === selector.enabled)
      && n.bounds.width > 0 && n.bounds.height > 0);
  }
  async visible(id: string | RegExp | Selector): Promise<void> { const n = await this.node(id); expect(n.bounds.width).toBeGreaterThan(0); expect(n.bounds.height).toBeGreaterThan(0); }
  async absent(id: string | RegExp | Selector): Promise<void> { await expect.poll(async () => (await this.nodes(id)).length).toBe(0); }
  async count(id: string | RegExp | Selector, n: number): Promise<void> { await expect.poll(async () => (await this.nodes(id)).length).toBe(n); }
  async text(id: string | RegExp | Selector): Promise<string> {
    const root = await this.node(id); const walk = (n: NativeNode): NativeNode[] => [n, ...(n.children || []).flatMap(walk)];
    const input = walk(root).find(n => /TextField|TextView/.test(n.clazz));
    if (input) { const value = input.value || ''; return value === input.attributes?.placeholderValue ? '' : value; }
    return String(root.text ?? root.value ?? '');
  }
  async within(id: string, childId: string): Promise<NativeNode[]> {
    const root = await this.node(id); const walk = (n: NativeNode): NativeNode[] => n.visible === false ? [] : [n, ...(n.children || []).flatMap(walk)];
    return walk(root).filter(n => n.res === childId && n.bounds.width > 0 && n.bounds.height > 0
      && n.bounds.x >= 0 && n.bounds.x < this.device.screenSize.width && n.bounds.y >= 0 && n.bounds.y < this.device.screenSize.height);
  }
  async hasText(id: string | RegExp | Selector, value: string | RegExp): Promise<void> {
    if (value instanceof RegExp) await expect.poll(() => this.text(id)).toMatch(value);
    else await expect.poll(() => this.text(id)).toBe(value);
  }
  async contains(id: string | RegExp | Selector, value: string): Promise<void> { await expect.poll(() => this.text(id)).toContain(value); }
  async fill(id: string, text: string): Promise<void> { await reveal(this.device, { res: id }); await this.device.fill({ res: id }, text); }
  async tap(id: string | Selector): Promise<void> {
    if (typeof id === 'string') await tap(this.device, id);
    else { await reveal(this.device, id); await this.device.tap(id); }
  }
  async back(): Promise<void> { await dismissKeyboard(this.device); await this.device.input.press('Back'); }
  async enabled(id: string, enabled: boolean): Promise<void> { await expect.poll(async () => (await this.node(id)).enabled).toBe(enabled); }
  async checkState(id: string | Selector): Promise<boolean> {
    const root = await this.node(id); const walk = (n: NativeNode): NativeNode[] => [n, ...(n.children || []).flatMap(walk)];
    return (walk(root).find(n => n.clazz === 'XCUIElementTypeSwitch') || root).checked === true;
  }
  async checked(id: string | Selector, checked: boolean): Promise<void> { await expect.poll(() => this.checkState(id)).toBe(checked); }
  async selected(id: string | Selector, selected: boolean): Promise<void> {
    await expect.poll(async () => { const n = await this.node(id); return n.selected ?? n.checked ?? n.attributes?.selected; }).toBe(selected);
  }
  async secure(id: string): Promise<void> { const root = await this.node(id); const walk = (n: NativeNode): NativeNode[] => [n, ...(n.children || []).flatMap(walk)]; const n = walk(root).find(n => /TextField|TextView/.test(n.clazz)) || root; expect(n.secure === true || /SecureTextField/.test(n.clazz), '必须是原生安全输入框').toBe(true); }
  async scroll(direction: 'up' | 'down', count = 1): Promise<void> {
    const { width, height } = this.device.screenSize;
    for (let i = 0; i < count; i++) await this.device.input.swipe({ x1: width / 2, y1: height * (direction === 'down' ? .78 : .3), x2: width / 2, y2: height * (direction === 'down' ? .3 : .78), duration: 600 });
  }
  async settings(id: string): Promise<void> { await this.tap('settings-tab'); await this.tap(id); }
  async openLogin(): Promise<void> { await this.tap('settings-tab'); await this.tap('sign-in-button'); await this.visible('username-or-email-sign-in-button'); }
  async loginForm(): Promise<void> { await this.openLogin(); await this.tap('username-or-email-sign-in-button'); await this.visible('username-input'); }
  async hall(): Promise<void> {
    // 全新安装的 Release 必须通过测试环境确认；不得跳过真实对话框。
    await this.device.wait({ res: /^(staging-confirmation-input|hall-tab)$/ }, { timeout: 120_000 });
    if ((await this.nodes('staging-confirmation-input')).length) {
      await this.fill('staging-confirmation-input', 'CONFIRM');
      await this.device.hideKeyboard();
      await this.tap('confirm-button');
    }
    await this.visible('hall-tab');
  }
  async guest(): Promise<void> { await this.device.reset(); await this.hall(); await this.tap('hall-tab'); this.session = undefined; }
  async signIn(account: Credentials = credentials()): Promise<Session> {
    let stage = '打开登录表单';
    try {
      await this.loginForm();
      stage = '填写用户名';
      await this.fill('username-input', account.username);
      stage = '收起用户名键盘';
      await this.device.hideKeyboard();
      stage = '填写密码';
      await this.fill('password-input', account.password);
      stage = '收起密码键盘';
      await this.device.hideKeyboard();
      stage = '提交登录并等待响应';
      const response = await this.network.waitForResponse({ method: 'POST', path: '/public/v10/user/login/username/password' }, () => this.tap('sign-in-button'));
      stage = '校验登录响应';
      success(response as ApiResponse);
      stage = '等待大厅登录态';
      await this.visible('hall-auth-state-signed-in');
      stage = '读取原生会话';
      const sessions = await this.network.sessions();
      const session = sessions.find((s: any) => s.key === response.session && s.username === account.username);
      if (!session?.userId || !session.authorization) throw new Error('原生真实登录后未观测到完整会话');
      this.session = { ...session, username: account.username } as Session;
      stage = '核对账户接口';
      expect(await accountStatus(this.session)).toBe(200);
      stage = '关闭登录后提示';
      await this.dismissNotices();
      return this.session;
    } catch { await this.device.terminate().catch(() => {}); throw new Error(`原生真实登录/会话核验失败，阶段：${stage}；凭据及表单内容未写入诊断`); }
  }
  async dismissNotices(): Promise<void> {
    // 只关闭识别出的救济金和隐私提示，未知业务错误保留并使案例失败。
    for (let i = 0; i < 4; i++) {
      if ((await this.nodes({ res: 'alert-message-text', text: /^(3000 free coins, please accept them|3000个免费的金币，请收下)$/ })).length) { await this.tap({ res:'alert-custom-button', text:/^(Cancel|取消)$/ }); continue; }
      if ((await this.nodes('privacy-popup-title')).length) { await this.tap('privacy-popup-agree'); continue; }
      break;
    }
  }
  async submitSearch(keyword: string): Promise<ApiResponse> {
    await this.fill('club-search-input', keyword);
    return await this.network.waitForResponse({ method: 'GET', path: '/v10/club/search' }, async () => {
      // Return sends the actual UITextField submit event rather than a synthetic HTTP request.
      const keyboard = (await this.device.nodes()).find(n => n.clazz === 'XCUIElementTypeKeyboard');
      const walk = (n: any): any[] => [n, ...(n.children || []).flatMap(walk)];
      const key = keyboard && walk(keyboard).find(n => n.clazz === 'XCUIElementTypeButton' && /^(Search|Return|Go|搜索|搜尋|前往)$/i.test(n.text || n.res || ''));
      if (!key) throw new Error('原生搜索键盘缺少可见 Search/Return 键，不能绕过UI直接发搜索请求');
      await this.device.input.tap({ x: key.bounds.x + key.bounds.width / 2, y: key.bounds.y + key.bounds.height / 2 });
    }) as ApiResponse;
  }
  async secondary(create = launchApplication): Promise<NativeCase> {
    const device = await create({ isolated: true });
    const child = new NativeCase(device, this.proxy);
    try { await child.hall(); return child; }
    catch (error) { await device.close().catch(() => {}); throw error; }
  }
  requiredSession(): Session { if (!this.session) throw new Error('此案例需要已验证的真实登录会话'); return this.session; }
}
