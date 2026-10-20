// XCUITest 原生设备适配：所有公开几何量使用截图像素，统一转换到 iOS point。
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { XMLParser } from 'fast-xml-parser';
import { PNG } from 'pngjs';
import { WebDriver } from '../webdriver.mjs';

export type Bounds = { x: number; y: number; width: number; height: number };
export type NativeSelector = { res?: string | RegExp; text?: string | RegExp; clazz?: string | RegExp;
  checked?: boolean; enabled?: boolean; scrollable?: boolean; clickable?: boolean; focused?: boolean };
export type NativeNode = { res?: string; text?: string; value?: string; clazz: string; secure: boolean;
  enabled: boolean; checked: boolean; visible: boolean; focused?: boolean; bounds: Bounds;
  attributes: Record<string, string>; children: NativeNode[] };
export class ElementNotFound extends Error { code = 'no such element'; }
/** simctl 保留奇数边长，WDA/录像可能去掉末列；只裁这一像素，不缩放内容。 */
export function normalizeNativeScreenshot(bytes: Buffer, size: { width: number; height: number }): Buffer {
  const source = PNG.sync.read(bytes);
  if (source.width === size.width && source.height === size.height) return bytes;
  if (size.width <= 0 || size.height <= 0 || source.width < size.width || source.height < size.height
    || source.width - size.width > 1 || source.height - size.height > 1) {
    throw new Error(`原生截图尺寸不匹配：${source.width}×${source.height}，预期 ${size.width}×${size.height}`);
  }
  // pngjs mutates its options; keep the shared device geometry immutable.
  const target = new PNG({ width: size.width, height: size.height });
  PNG.bitblt(source, target, 0, 0, size.width, size.height, 0, 0);
  return PNG.sync.write(target);
}
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false,
  processEntities: false, allowBooleanAttributes: false });
const decodeXml = (value: string) => value.replace(/&(quot|apos|amp|lt|gt|#x[0-9a-f]+|#\d+);/gi, (_, key: string) => {
  const named: Record<string, string> = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>' };
  return named[key] ?? String.fromCodePoint(key.startsWith('#x') ? parseInt(key.slice(2), 16) : Number(key.slice(1)));
});
const matchesValue = (value: string | undefined, expected: string | RegExp | undefined) => expected === undefined
  || (typeof expected === 'string' ? value === expected : new RegExp(expected.source, expected.flags.replace('g', '')).test(value || ''));

/** 从真实 XCUITest XML 保留子树及原生属性，拒绝把隐藏节点作为就绪状态。 */
export function parseNativeTree(xml: string, scale: { x: number; y: number }): NativeNode[] {
  const roots: NativeNode[] = [];
  function visit(container: Record<string, unknown>): NativeNode[] {
    const result: NativeNode[] = [];
    for (const [clazz, raw] of Object.entries(container)) {
      if (!clazz.startsWith('XCUIElementType')) continue;
      for (const item of Array.isArray(raw) ? raw : [raw]) {
        if (!item || typeof item !== 'object') continue;
        const attributes = Object.fromEntries(Object.entries(item).filter(([, value]) => typeof value !== 'object')
          .map(([key, value]) => [key, decodeXml(String(value))]));
        const left = Math.floor(Number(attributes.x || 0) * scale.x);
        const top = Math.floor(Number(attributes.y || 0) * scale.y);
        const right = Math.ceil((Number(attributes.x || 0) + Number(attributes.width || 0)) * scale.x);
        const bottom = Math.ceil((Number(attributes.y || 0) + Number(attributes.height || 0)) * scale.y);
        const node: NativeNode = {
          res: attributes.name, text: attributes.value || attributes.label, value: attributes.value,
          clazz, secure: clazz === 'XCUIElementTypeSecureTextField', enabled: attributes.enabled === 'true',
          checked: attributes.selected === 'true' || (clazz === 'XCUIElementTypeSwitch' && attributes.value === '1'),
          visible: attributes.visible !== 'false', focused: attributes.focused === 'true', attributes,
          bounds: { x: left, y: top, width: right - left, height: bottom - top },
          children: visit(item as Record<string, unknown>),
        };
        result.push(node);
      }
    }
    return result;
  }
  const tree = parser.parse(xml);
  roots.push(...visit(tree), ...Object.entries(tree).filter(([key]) => !key.startsWith('XCUIElementType'))
    .flatMap(([, value]) => value && typeof value === 'object' ? visit(value as Record<string, unknown>) : []));
  return roots;
}

/** iPhone 没有隐藏键时只点非交互文本；Return/Search/Go 可能提交表单。 */
export function keyboardDismissTarget(nodes: NativeNode[]): NativeNode | undefined {
  const keyboard = nodes.find(node => node.clazz === 'XCUIElementTypeKeyboard');
  if (!keyboard) return;
  const descendants = (node: NativeNode): NativeNode[] => [node, ...node.children.flatMap(descendants)];
  const done = descendants(keyboard).find(node => node.visible && node.enabled
    && node.clazz === 'XCUIElementTypeButton' && /^(Done|完成|完畢)$/.test(node.text || ''));
  if (done) return done;
  const interactive = new Set(nodes.filter(node => /Button|Link|Cell|TextField|TextView|Keyboard/.test(node.clazz)).flatMap(descendants));
  return nodes.find(node => node.visible && node.enabled && node.clazz === 'XCUIElementTypeStaticText'
    && !interactive.has(node) && node.bounds.y + node.bounds.height < keyboard.bounds.y);
}

export class NativeDevice {
  screenSize = { width: 0, height: 0 };
  private scale = { x: 1, y: 1 };
  private timeout = 30_000;
  private lastInput: string | undefined;
  constructor(public driver: WebDriver, public udid: string, private onClose: () => Promise<void>,
    private onReset: () => Promise<void>, public applicationId: string) {}
  async initialize() {
    const image = PNG.sync.read(await this.screenshot());
    const window = await this.driver.request('GET', this.driver.path('/window/rect'));
    this.screenSize = { width: image.width, height: image.height };
    this.scale = { x: image.width / window.width, y: image.height / window.height };
    if (![this.scale.x, this.scale.y].every(value => Number.isFinite(value) && value > 0)) throw new Error('iOS point/pixel 比例无效。');
  }
  setDefaultTimeout(timeout: number) { this.timeout = timeout; }
  async nodes(): Promise<NativeNode[]> {
    const roots = parseNativeTree(await this.driver.source(), this.scale);
    const flatten = (node: NativeNode): NativeNode[] => [node, ...node.children.flatMap(flatten)];
    return roots.flatMap(flatten).filter(node => node.visible && node.bounds.width > 0 && node.bounds.height > 0
      && node.bounds.x < this.screenSize.width && node.bounds.y < this.screenSize.height
      && node.bounds.x + node.bounds.width > 0 && node.bounds.y + node.bounds.height > 0);
  }
  private matches(node: NativeNode, selector: NativeSelector) {
    // 仅对跨平台语义类做明确映射，不接受任意 Android 原生类型。
    const clazz = selector.clazz === 'android.widget.ScrollView' ? 'XCUIElementTypeScrollView'
      : selector.clazz === 'android.widget.ProgressBar' ? 'XCUIElementTypeActivityIndicator' : selector.clazz;
    return matchesValue(node.res, selector.res) && matchesValue(node.text, selector.text) && matchesValue(node.clazz, clazz)
      && (selector.enabled === undefined || node.enabled === selector.enabled)
      && (selector.checked === undefined || node.checked === selector.checked)
      && (selector.focused === undefined || node.focused === selector.focused)
      && (selector.clickable === undefined || !selector.clickable || /Button|Link|Cell/.test(node.clazz))
      && (selector.scrollable === undefined || !selector.scrollable || /ScrollView|CollectionView|Table/.test(node.clazz));
  }
  async info(selector: NativeSelector): Promise<NativeNode> {
    const node = (await this.nodes()).find(item => this.matches(item, selector));
    if (!node) throw new ElementNotFound(`找不到原生控件：${JSON.stringify(selector)}`);
    return node;
  }
  async marker(res: string): Promise<NativeNode | null> {
    return (await this.nodes()).find(node => node.res === res) || null;
  }
  async wait(selector: NativeSelector, options: { timeout?: number; state?: 'gone' | 'visible' } = {}) {
    const deadline = Date.now() + (options.timeout ?? this.timeout);
    do {
      const found = (await this.nodes()).find(node => this.matches(node, selector));
      if (options.state === 'gone' ? !found : found) return;
      await delay(250);
    } while (Date.now() < deadline);
    throw new ElementNotFound(`等待控件${options.state === 'gone' ? '消失' : '出现'}超时：${JSON.stringify(selector)}`);
  }
  async tap(selector: NativeSelector) {
    await this.wait(selector);
    const node = await this.info(selector);
    if (!node.enabled) throw new Error(`原生控件被禁用：${node.res || node.text}`);
    await this.input.tap({ x: node.bounds.x + node.bounds.width / 2, y: node.bounds.y + node.bounds.height / 2 });
  }
  async fill(selector: NativeSelector, text: string) {
    const node = await this.info(selector);
    let element = node.res ? await this.driver.find(node.res) : undefined;
    if (!element) throw new Error('输入必须有可追踪的原生 accessibility identifier。');
    // React Native 可能把 testID 放在输入容器，明确查询其原生输入子节点。
    if (!/TextField|TextView/.test(node.clazz)) {
      const nested = await this.driver.request('POST', this.driver.path(`/element/${element}/element`),
        { using: '-ios class chain', value: '**/XCUIElementTypeAny[`type == "XCUIElementTypeTextField" OR type == "XCUIElementTypeSecureTextField" OR type == "XCUIElementTypeTextView"`]' });
      element = nested['element-6066-11e4-a52e-4f735466cecf'];
    }
    this.lastInput = element;
    await this.driver.request('POST', this.driver.path(`/element/${element}/clear`), {});
    for (const character of text) {
      await this.driver.request('POST', this.driver.path(`/element/${element}/value`), { text: character });
      await delay(150);
    }
  }
  screenshot() { return this.driver.screenshot(); }
  async nativeScreenshot(): Promise<Buffer> {
    return normalizeNativeScreenshot(execFileSync('xcrun', ['simctl', 'io', this.udid, 'screenshot', '--type=png', '--mask=ignored', '-'],
      { maxBuffer: 32 * 1024 * 1024, timeout: 30_000, stdio: ['ignore', 'pipe', 'ignore'] }), this.screenSize);
  }
  async execute(script: string, args: Record<string, unknown> = {}) {
    return this.driver.request('POST', this.driver.path('/execute/sync'), { script, args: [args] });
  }
  async hideKeyboard() {
    if (!(await this.nodes()).some(node => node.clazz === 'XCUIElementTypeKeyboard')) return;
    try { await this.execute('mobile: hideKeyboard'); }
    catch (error) {
      const target = keyboardDismissTarget(await this.nodes());
      if (!target) throw error;
      await this.input.tap({ x: target.bounds.x + target.bounds.width / 2, y: target.bounds.y + target.bounds.height / 2 });
    }
    await this.wait({ clazz: 'XCUIElementTypeKeyboard' }, { state: 'gone' });
  }
  async alertText(): Promise<string | null> {
    try { return await this.driver.request('GET', this.driver.path('/alert/text')); }
    catch (error) { if ((error as { code?: string }).code === 'no such alert') return null; throw error; }
  }
  async acceptAlert() { await this.driver.request('POST', this.driver.path('/alert/accept'), {}); }
  async dismissAlert() { await this.driver.request('POST', this.driver.path('/alert/dismiss'), {}); }
  get bundleId() { return this.applicationId; }
  async grantPermission(permission: 'microphone' | 'camera' | 'photos') {
    execFileSync('xcrun', ['simctl', 'privacy', this.udid, 'grant', permission, this.applicationId], { timeout: 30_000 });
  }
  async terminate() { await this.execute('mobile: terminateApp', { bundleId: this.applicationId }); }
  async launch() { await this.execute('mobile: activateApp', { bundleId: this.applicationId }); }
  async home() { await this.execute('mobile: pressButton', { name: 'home' }); }
  async restart() {
    await this.execute('mobile: terminateApp', { bundleId: this.applicationId });
    await this.execute('mobile: activateApp', { bundleId: this.applicationId });
  }
  async reset() { await this.onReset(); await this.initialize(); }
  async close() { await this.onClose(); }
  async withDragHold(options: { from: { x: number; y: number }; to: { x: number; y: number }; holdMs?: number }, callback: () => Promise<void>) {
    const { from, to, holdMs = 6000 } = options;
    let failure: unknown;
    const gesture = this.pointer([
      { type: 'pointerMove', duration: 0, x: Math.round(from.x / this.scale.x), y: Math.round(from.y / this.scale.y) },
      { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 200 },
      { type: 'pointerMove', duration: 600, x: Math.round(to.x / this.scale.x), y: Math.round(to.y / this.scale.y) },
      { type: 'pause', duration: holdMs }, { type: 'pointerUp', button: 0 },
    ]).catch(error => { failure = error; });
    try { await delay(1500); if (failure) throw failure; await callback(); }
    finally { await gesture; }
    if (failure) throw failure;
  }
  private async pointer(actions: Record<string, unknown>[]) {
    await this.driver.request('POST', this.driver.path('/actions'),
      { actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions }] });
  }
  input = {
    tap: async ({ x, y }: { x: number; y: number }) => {
      await this.execute('mobile: tap', { x: x / this.scale.x, y: y / this.scale.y });
    },
    swipe: async ({ x1, y1, x2, y2, duration = 600 }: { x1: number; y1: number; x2: number; y2: number; duration?: number }) => {
      await this.pointer([
        { type: 'pointerMove', duration: 0, x: Math.round(x1 / this.scale.x), y: Math.round(y1 / this.scale.y) },
        { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 100 },
        { type: 'pointerMove', duration, x: Math.round(x2 / this.scale.x), y: Math.round(y2 / this.scale.y) },
        { type: 'pointerUp', button: 0 },
      ]);
    },
    press: async (key: string, snapshot?: NativeNode[]) => {
      if (key !== 'Back') throw new Error(`未实现的 iOS 按键语义：${key}`);
      // The caller may pass the current, unmodified navigation snapshot. Reuse it
      // for this one action; never retain it after a tap/swipe/keyboard dismissal.
      const nodes = snapshot ?? await this.nodes();
      if (nodes.some(node => node.clazz === 'XCUIElementTypeKeyboard')) return this.hideKeyboard();
      const identifiers = ['navigation-bar-back-button', 'navigation-bar-back-image', 'header-back-button', 'back-button', 'close-user-authentication-button', 'close-button'];
      const close = identifiers.map(id => nodes.find(node => node.res === id)).find(Boolean)
        || nodes.find(node => node.clazz === 'XCUIElementTypeButton' && /^(Back|返回|返回上一頁)$/.test(node.text || ''));
      if (close) return this.input.tap({ x: close.bounds.x + close.bounds.width / 2, y: close.bounds.y + close.bounds.height / 2 });
      // iOS 原生导航的左边缘返回手势；调用者必须断言目的页/弹层变化。
      await this.input.swipe({ x1: 2, y1: this.screenSize.height / 2, x2: this.screenSize.width * 0.85,
        y2: this.screenSize.height / 2, duration: 500 });
    },
    type: async (text: string) => {
      if (!this.lastInput) throw new Error('发送按键前必须通过fill聚焦真实输入框。');
      await this.driver.request('POST', this.driver.path(`/element/${this.lastInput}/value`), { text });
    },
  };
}
