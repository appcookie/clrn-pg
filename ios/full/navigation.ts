// 沿用共享业务 testID，通过真实 iOS 导航、滑动和输入进入每个状态。
import { expect } from '@playwright/test';
import { setTimeout as delay } from 'node:timers/promises';
import type { NativeDevice, NativeNode, NativeSelector } from './native-device';
import type { VisualScenario } from '../../visual/scenarioTypes';
import type { ScreenshotBounds } from './screenshot';
import { exists, waitAbsent } from './native-state';
import { nativeSelector } from './scenarios';
import { waitForCountryPicker } from './country-picker';
import { scrollToEnd } from './scroll-end';
import { openNativeLegalDocument, waitForNativeLegalDocument } from './legal-document';
import { fullyInside, intersectBounds, nativeViewport, pointInside } from './native-viewport';
import { waitForClubReady } from './guest-club-ready';
export { dismissKeyboard } from './keyboard';

export async function reveal(device: NativeDevice, selector: NativeSelector, fullyVisible = false) {
  for (let attempt = 0; attempt < 10; attempt++) {
    let geometry: ReturnType<typeof nativeViewport> | undefined;
    const screen = { x: 0, y: 0, width: device.screenSize.width,
      height: device.screenSize.height * (fullyVisible ? 0.93 : 0.98) };
    try {
      await device.wait(selector, { timeout: attempt === 0 ? 5000 : 1000 });
      const target = await device.info(selector);
      geometry = nativeViewport(await device.nodes(), target, screen);
      const bounds = geometry.node.bounds;
      if (fullyVisible ? fullyInside(bounds, geometry.viewport)
        : pointInside({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, geometry.viewport)) return;
    } catch (error) { if ((error as { code?: string }).code !== 'no such element') throw error; }
    if (attempt === 9) throw new Error(`滚动后仍未显示控件：${JSON.stringify(selector)}`);
    await device.hideKeyboard();
    if (await exists(device, { res: 'stepDescription' })) {
      await tap(device, await exists(device, { res: 'tooltip-finish-button' }) ? 'tooltip-finish-button' : 'tooltip-next-button');
      continue;
    }
    // Scroll inside the target's nearest ancestor, not a background/sibling list.
    const ancestor = geometry?.scrollables.slice().reverse().find(item => item.viewport.width > 20 && item.viewport.height > 20);
    const fallback = !geometry && (await device.nodes()).find(node => /ScrollView|CollectionView|Table/.test(node.clazz)
      && node.bounds.height > device.screenSize.height * 0.3);
    const viewport = ancestor?.viewport ?? (fallback ? intersectBounds(screen, fallback.bounds) : undefined);
    if (!viewport) throw new Error(`控件被裁切且无可滚动祖先：${JSON.stringify(selector)}`);
    const { x, y, width, height } = viewport;
    const upward = !geometry || geometry.node.bounds.y >= geometry.viewport.y;
    await device.input.swipe({ x1: x + width * 0.97, y1: y + height * (upward ? 0.85 : 0.2),
      x2: x + width * 0.97, y2: y + height * (upward ? 0.2 : 0.85), duration: 600 });
  }
}
/** Seed the first real observation before polling; a slow first XCTest tree is
 * not evidence of movement. Still require a later, enabled observation to agree.
 */
export async function stableNativeTarget(device: Pick<NativeDevice, 'info'>, identifier: string,
  { timeout = 10_000, interval = 200 } = {}): Promise<NativeNode> {
  let target = await device.info({ res: identifier });
  const deadline = Date.now() + timeout;
  for (;;) {
    await delay(interval);
    const before = target.bounds;
    // Complete each driver query under its own request timeout. Aborting a
    // snapshot halfway through the first comparison leaves no stability evidence.
    target = await device.info({ res: identifier });
    try {
      expect(target.enabled, `${identifier} 应启用`).toBe(true);
      expect(target.bounds, '点击前等待原生布局稳定').toEqual(before);
      return target;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
  }
}
export type NativeTapObservation = {
  target: Pick<NativeNode, 'res' | 'bounds' | 'visible' | 'enabled'>;
  point: { x: number; y: number };
  observedAtUtc: string;
  connectionUi: { connecting: boolean | null; timeout: boolean | null };
};
export async function tap(device: NativeDevice, identifier: string,
  observeInput?: (observation: NativeTapObservation) => void) {
  await reveal(device, { res: identifier });
  const target = await stableNativeTarget(device, identifier);
  const nodes = await device.nodes();
  const { node, viewport } = nativeViewport(nodes, target, { x: 0, y: 0, ...device.screenSize });
  const { bounds } = node;
  const warning = nodes.find(node => node.res === 'switch-to-production-tip-container');
  const overlaps = warning && bounds.y < warning.bounds.y + warning.bounds.height && bounds.y + bounds.height > warning.bounds.y;
  const point = { x: bounds.x + bounds.width * (overlaps || identifier === 'username-or-email-sign-in-button' ? 0.95 : 0.5),
    y: bounds.y + bounds.height / 2 };
  if (!pointInside(point, viewport)) throw new Error(`点击位置仍被祖先裁切：${identifier}`);
  // 只读回执位于原有真实点击之前，不添加查询、等待、重试或第二次点击。
  observeInput?.({ target: { res: node.res, bounds: { ...bounds }, visible: node.visible, enabled: node.enabled },
    point: { ...point }, observedAtUtc: new Date().toISOString(), connectionUi: {
      connecting: nodes.some(item => item.visible && item.text === 'Connecting...'),
      timeout: nodes.some(item => item.visible && /Connection Timeout/i.test(item.text || '')),
    } });
  await device.input.tap(point);
}

/** Guest login must open from the actual account tab, not scroll a missed tab tap's hall. */
export async function selectGuestSettingsTab(device: NativeDevice,
  { timeout = 5000, tapTab = () => tap(device, 'settings-tab') }: { timeout?: number; tapTab?: () => Promise<void> } = {}) {
  const visible = (node: NativeNode) => node.visible !== false && node.bounds.width > 0 && node.bounds.height > 0;
  const screen = { x: 0, y: 0, ...device.screenSize };
  const visibleInTree = (nodes: NativeNode[], node: NativeNode) => {
    if (!visible(node)) return false;
    const geometry = nativeViewport(nodes, node, screen);
    return visible(geometry.node) && geometry.visibleBounds.width > 0 && geometry.visibleBounds.height > 0;
  };
  const blocked = (nodes: NativeNode[]) => nodes.some(node => (
    /^(XCUIElementTypeAlert|XCUIElementTypeKeyboard|XCUIElementTypeSheet)$/.test(node.clazz)
    || /^(alert-message-text|popup-content-container|confirm-pop-up-image-background|staging-dialog|html-render|country-code-list|base-create-room-screen|username-or-email-sign-in-button)$/.test(node.res || '')
  ) && visibleInTree(nodes, node));
  const actionable = (nodes: NativeNode[], res: string) => {
    const target = nodes.find(node => node.res === res && visible(node) && node.enabled);
    if (!target) return false;
    const { node, viewport } = nativeViewport(nodes, target, screen);
    return visible(node) && pointInside({ x: node.bounds.x + node.bounds.width / 2,
      y: node.bounds.y + node.bounds.height / 2 }, viewport);
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    await tapTab();
    const deadline = Date.now() + timeout;
    let nodes: NativeNode[];
    do {
      nodes = await device.nodes();
      if (blocked(nodes)) throw new Error('切换我的标签时出现错误弹窗、键盘或其他模态页面');
      if (nodes.some(node => node.res === 'settings-list' && visibleInTree(nodes, node)) && actionable(nodes, 'sign-in-button')) return;
      if (Date.now() >= deadline) break;
      await delay(200);
    } while (true);
    // Retry one real tap only when the old hall is still visibly active and its
    // tab button remains actionable. Other pages never receive blind scrolling.
    const hall = nodes.find(node => node.res === 'hall-content-list' && visibleInTree(nodes, node));
    if (attempt === 1 || !hall || !actionable(nodes, 'settings-tab')) {
      throw new Error('点击我的标签后未显示可操作的游客登录页面');
    }
    console.info('首次点击我的标签后仍在无遮挡大厅，重新点击一次并验证目标页。');
  }
}
async function closePicker(device: NativeDevice) {
  const { bounds } = await device.info({ res: 'select-game-category-text' });
  await device.input.tap({ x: device.screenSize.width * 0.02, y: Math.max(device.screenSize.height * 0.04, bounds.y - device.screenSize.height * 0.08) });
  await waitAbsent(device, { res: 'select-game-category-text' });
}
export async function returnToTabs(device: NativeDevice) {
  for (let attempt = 0; attempt < 12; attempt++) {
    // 分支判断期间没有 UI 操作，复用本轮树；操作后下一轮重新读取。
    const nodes = await device.nodes();
    const has = (identifier: string) => nodes.some(node => node.res === identifier);
    if (has('stepDescription')) {
      await tap(device, has('tooltip-finish-button') ? 'tooltip-finish-button' : 'tooltip-next-button');
    } else if (has('slot-machine-view')) {
      await tap(device, 'close-button');
      await waitAbsent(device, { res: 'slot-machine-view' });
    } else if (has('confirm-pop-up-image-background')) {
      await tap(device, 'cancel-button');
      await waitAbsent(device, { res: 'confirm-pop-up-image-background' });
    } else if (has('select-game-category-text')) {
      await closePicker(device);
    } else if (has('base-create-room-screen')) {
      await device.input.press('Back', nodes);
      await waitAbsent(device, { res: 'base-create-room-screen' });
    } else if (has('settings-tab')) return;
    else await device.input.press('Back', nodes);
  }
  throw new Error('未能通过真实导航返回主标签。');
}
export async function fillScenarioInputs(device: NativeDevice, scenario: VisualScenario) {
  for (const rule of scenario.fixedTexts.filter(item => /input"\]$/.test(item.selector))) {
    const selector = nativeSelector(rule.selector);
    await reveal(device, selector);
    await device.fill(selector, rule.text);
    await device.hideKeyboard();
  }
}
export async function revealScenarioReady(device: NativeDevice, scenario: Pick<VisualScenario, 'visualReadySelector' | 'readyText' | 'pageLabel' | 'signIn'>) {
  const selector = nativeSelector(scenario.visualReadySelector);
  if (selector.res === 'user-agreement-screen' || selector.res === 'user-privacy-screen') {
    await waitForNativeLegalDocument(device, selector.res === 'user-agreement-screen' ? 'user-agreement' : 'user-privacy');
    return;
  }
  if (selector.res === 'pick-country-code-container') {
    return waitForCountryPicker(device);
  }
  if (selector.res === 'club-tab-screen') {
    if (scenario.signIn !== true && !(scenario.pageLabel === 'guest_club' && scenario.signIn === false)) {
      throw new Error('俱乐部就绪检查需要明确的游客场景或已登录场景。');
    }
    await waitForClubReady(device, { signIn: scenario.signIn });
    return;
  }
  if (selector.res === 'game-matching-sign-in-popup') {
    // On iOS this ID belongs to the hidden hall mount point, not the presented
    // native modal. CI showed its 2559px bounds extending below the hall scroll
    // viewport while the actual prompt and both actions were fully visible.
    if (!scenario.readyText) throw new Error('游客游戏登录弹窗必须提供对应语言的就绪文案。');
    await reveal(device, { res: 'popup-content-container' });
    await device.wait({ res: 'pop-up-message-text', text: scenario.readyText });
    for (const res of ['cancel-button', 'confirm-button']) {
      await device.wait({ res, enabled: true });
      await reveal(device, { res });
    }
    return;
  }
  await reveal(device, selector);
}
export type NavigationResult = { backgroundBanner?: ScreenshotBounds; readySnapshot?: NativeNode[] };
export async function navigateScenario(device: NativeDevice, scenario: VisualScenario): Promise<NavigationResult> {
  await returnToTabs(device);
  await tap(device, scenario.tabTestId || 'hall-tab');
  for (let reset = 0; reset < 3; reset++) {
    const list = (await device.nodes()).find(node => /ScrollView|CollectionView|Table/.test(node.clazz)
      && node.bounds.height > device.screenSize.height * 0.3);
    if (!list) break;
    const { x, y, width, height } = list.bounds;
    await device.input.swipe({ x1: x + width * 0.5, y1: y + height * 0.2,
      x2: x + width * 0.5, y2: y + height * 0.85, duration: 600 });
  }
  let filled = false;
  let backgroundBanner: ScreenshotBounds | undefined;
  for (const identifier of scenario.navClickTestIds) {
    if (['share-app', 'official-site', 'about-laiwan'].includes(identifier)) {
      await reveal(device, { res: 'about-laiwan' }, true);
      await scrollToEnd(device, { res: 'settings-list' }, { res: 'about-laiwan' });
    }
    if (['search_sign_in_prompt', 'guest_game_sign_in_prompt'].includes(scenario.pageLabel)) {
      backgroundBanner = (await device.marker('slot-banner'))?.bounds;
    }
    if (identifier === 'advanced-options-button') { await fillScenarioInputs(device, scenario); filled = true; }
    if (identifier === 'personal-house-create' || identifier === 'personal-house-join') {
      await tap(device, 'hall-tab');
      await tap(device, identifier);
      if (identifier === 'personal-house-create') {
        await reveal(device, { res: 'select-game-category-text' });
        if (!scenario.navClickTestIds.includes('create-game-button')) await closePicker(device);
      } else await reveal(device, { res: 'copy-house-number-button' });
    } else if (identifier === 'create-game-button' && await exists(device, { res: 'select-game-category-text' })) continue;
    else if (identifier === 'user-agreement-button' || identifier === 'user-privacy-button') {
      await openNativeLegalDocument(device, identifier === 'user-agreement-button' ? 'user-agreement' : 'user-privacy',
        entry => tap(device, entry));
    } else if (identifier === 'hall-sign-in-button') {
      await selectGuestSettingsTab(device);
      await tap(device, 'sign-in-button');
      await device.wait({ res: 'username-or-email-sign-in-button' });
    } else await tap(device, identifier);
  }
  if (!filled) await fillScenarioInputs(device, scenario);
  const readySnapshot = await revealScenarioReady(device, scenario);
  if (readySnapshot) {
    // This country's readiness snapshot already checks loading, errors, keyboard
    // and actionable geometry. There is no UI action before screenshot masking.
    // New constraints must be implemented explicitly rather than silently omitted.
    if (scenario.pageLabel !== 'login_pick_country_code' || scenario.readyText || scenario.visualGoneSelector
      || scenario.fixedTexts.length || scenario.navClickTestIds.includes('advanced-options-button')) {
      throw new Error('国家区号快照就绪分支尚未覆盖新增场景约束');
    }
    return { backgroundBanner, readySnapshot };
  }
  if (scenario.pageLabel === 'hall') await scrollToEnd(device, { res: 'hall-content-list' }, { res: 'hall-sign-in-button' });
  if (scenario.navClickTestIds.includes('advanced-options-button')) {
    await scrollToEnd(device, { scrollable: true }, { res: 'create-room-tips-text' });
  }
  if (scenario.visualGoneSelector) await waitAbsent(device, nativeSelector(scenario.visualGoneSelector));
  if (scenario.readyText) await device.wait({ text: scenario.readyText });
  if (scenario.waitForLoading) await waitAbsent(device, { clazz: 'XCUIElementTypeActivityIndicator' });
  await waitAbsent(device, { res: 'alert-message-text' });
  await device.hideKeyboard();
  return { backgroundBanner };
}
export async function signIn(device: NativeDevice, username = process.env.VISUAL_USERNAME, password = process.env.VISUAL_PASSWORD) {
  if (!username || !password) throw new Error('登录测试必须提供本轮独占的测试账户。');
  await returnToTabs(device);
  await tap(device, 'settings-tab');
  await tap(device, 'sign-in-button');
  await tap(device, 'username-or-email-sign-in-button');
  await device.fill({ res: 'username-input' }, username);
  await device.hideKeyboard();
  await reveal(device, { res: 'password-input' });
  await device.fill({ res: 'password-input' }, password);
  await device.hideKeyboard();
  await tap(device, 'sign-in-button');
  await device.wait({ res: 'settings-tab' }, { timeout: 60_000 });
  await tap(device, 'settings-tab');
  await device.wait({ res: 'user-info-button' }, { timeout: 30_000 });
}
export async function selectLanguage(device: NativeDevice, locale: string) {
  const identifier = { en: 'english', 'zh-Hans': 'zh-hans', 'zh-Hant': 'zh-hant' }[locale];
  if (!identifier) throw new Error(`不支持的测试语言：${locale}`);
  await returnToTabs(device);
  await tap(device, 'settings-tab');
  await tap(device, 'sign-in-button');
  await tap(device, 'switch-language-button');
  await tap(device, identifier);
  await tap(device, 'confirm-button');
  const expected = { en: 'English', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文' }[locale];
  await device.wait({ res: 'switch-language-label', text: expected });
  await tap(device, 'close-user-authentication-button');
  await device.wait({ res: 'settings-tab' });
}
