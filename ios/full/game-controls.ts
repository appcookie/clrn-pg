// 依据原生可见性、连接状态和两次稳定布局执行牌桌操作，每次业务动作只触发一次。
import { expect } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from './native-device';
import type { ScreenshotBounds } from './screenshot';
import { setTimeout as delay } from 'node:timers/promises';

export type NativeNode = { res?: string; text?: string; clazz?: string; enabled?: boolean; checked?: boolean; visible?: boolean;
  bounds: ScreenshotBounds; children?: NativeNode[] };

/** 只拒绝明确的连接超时；其他业务弹窗可能是用例需要验证的确认状态。
 */
export function gameConnectionState(nodes: NativeNode[]): { connecting: boolean } {
  if (nodes.some(node => node.visible !== false && /Connection Timeout/i.test(node.text || ''))) {
    throw new Error('出现 Connection Timeout；不能继续点击或等待重试掩盖连接错误');
  }
  return { connecting: nodes.some(node => /Connecting\.\.\./.test(node.text || '')) };
}

/** XCUITest 截图保留原始像素，错误不能变成空帧。 */
export async function gameScreenshot(device: AndroidDevice): Promise<Buffer> {
  const png = await device.nativeScreenshot();
  if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('原生截图没有返回 PNG。');
  return png;
}

/** 短时提示查询；只有真实无节点返回 null。 */
export async function gameMarker(device: AndroidDevice, resource: string): Promise<NativeNode | null> {
  return device.marker(resource);
}

/** 读取真实 iOS 无障碍树，保留子树中的牌面语义。 */
export async function gameNodes(device: AndroidDevice): Promise<NativeNode[]> {
  const nodes = await device.nodes();
  return nodes.filter(node => visibleNode(node, device.screenSize));
}

function visibleNode(node: NativeNode, screen: { width: number; height: number }): boolean {
  return node.bounds.width > 0 && node.bounds.height > 0
    && node.bounds.x < screen.width && node.bounds.y < screen.height
    && node.bounds.x + node.bounds.width > 0 && node.bounds.y + node.bounds.height > 0;
}

/** 展开已可见容器的子树；默认界限取容器范围而非 Android 固定分辨率。 */
export function flattenNodes(root: NativeNode): NativeNode[] {
  return [root, ...(root.children || []).flatMap(flattenNodes)]
    .filter(node => node.bounds.width > 0 && node.bounds.height > 0);
}

/**
 * 从已确认可见的容器读取语义文字，保留 Android 裁到容器外的透明辅助节点。
 * @param root - 当前可见玩家或牌面容器，不能传入整棵窗口树。
 * @param marker - 明确指定的辅助文字标记。
 */
export function gameSemanticText(root: NativeNode | undefined, marker: string): string | undefined {
  if (!root) return undefined;
  if (root.res === marker) return root.text;
  for (const child of root.children || []) {
    const value = gameSemanticText(child, marker);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * 读取可见容器边界内的控件，兼容 Fabric 把内容压平为容器兄弟节点的情况。
 * @param nodes - 本次完整查询得到的可见控件。
 * @param marker - 要限定的真实容器标记。
 */
export function gameNodesWithin(nodes: NativeNode[], marker: string): NativeNode[] {
  const container = nodes.find(node => node.res === marker)?.bounds;
  if (!container) return [];
  return nodes.filter(node => node.bounds.x >= container.x && node.bounds.y >= container.y
    && node.bounds.x + node.bounds.width <= container.x + container.width
    && node.bounds.y + node.bounds.height <= container.y + container.height);
}

/**
 * 读取真实容器边界内的全部可见文字。
 * @param nodes - 本次完整查询得到的可见控件。
 * @param marker - 要限定的真实容器标记。
 */
export function gameTextWithin(nodes: NativeNode[], marker: string): string[] {
  return gameNodesWithin(nodes, marker).filter(node => node.text).map(node => node.text!);
}

/**
 * 等待实际可见的游戏控件；空查询不会吞掉驱动错误。
 * @param device - 专用模拟器连接。
 * @param res - 与 Web 共用的 testID。
 * @param text - 可选的就绪文字。
 */
export async function gameReady(device: AndroidDevice, res: string, text?: string): Promise<NativeNode> {
  let found: NativeNode | undefined;
  await expect.poll(async () => {
    const nodes = await gameNodes(device);
    const { connecting } = gameConnectionState(nodes);
    found = connecting ? undefined : nodes.find(node => node.res === res && (text === undefined || node.text === text));
    return found;
  }, { message: `${res} 应可见且连接正常`, timeout: 45_000, intervals: [250] }).toBeDefined();
  return found!;
}

/** 等待录像后的真实控件；优先查询目标，predicate 漏报时读取完整原生树。 */
export async function gameReadyCurrent(device: AndroidDevice, res: string, text?: string): Promise<NativeNode> {
  await device.prepareTransientCapture();
  let found: NativeNode | undefined;
  await expect.poll(async () => {
    const observation = await device.inputObservation(res);
    const { connecting } = gameConnectionState(observation);
    const nodes = observation.some(node => node.res === res) || connecting
      ? observation : await gameNodes(device);
    found = !gameConnectionState(nodes).connecting ? nodes.find(node => node.res === res &&
      (text === undefined || node.text === text)) as NativeNode | undefined : undefined;
    return found;
  }, { message: `${res} 应可见且连接正常`, timeout: 90_000, intervals: [250] }).toBeDefined();
  return found!;
}

/**
 * 等待游戏弹层完全移出屏幕。
 * @param device - 专用模拟器连接。
 * @param res - 弹层标记。
 */
export async function gameGone(device: AndroidDevice, res: string): Promise<void> {
  await expect.poll(async () => {
    const nodes = await gameNodes(device);
    const { connecting } = gameConnectionState(nodes);
    // 重连遮罩可能隐藏面板；只有连接正常后的真实消失才能作为关闭证据。
    return connecting || nodes.some(node => node.res === res);
  }, { message: `${res} 应在连接正常时消失`, timeout: 45_000, intervals: [250] }).toBe(false);
}

/** 等待房间重连遮罩退去并确认牌桌至少一秒内持续可操作。
 * @param device - 专用模拟器连接。
 * @param stableMs - 指定入口需要额外连续无重连遮罩的时间。
 */
export async function gameConnected(device: AndroidDevice, stableMs = 0): Promise<void> {
  await connectedObservation(device, stableMs);
}

/** 录制期间只读取实际连接提示；仍须持续就绪，超时错误直接失败。 */
export async function gameConnectedCurrent(device: AndroidDevice, stableMs = 0): Promise<void> {
  await device.prepareTransientCapture();
  await connectedObservation(device, stableMs, () => device.inputObservation());
}

/** 录制期间等待真实面板标记消失；完整独立终点仍由转场采集器检查。 */
export async function gameGoneCurrent(device: AndroidDevice, res: string): Promise<void> {
  await device.prepareTransientCapture();
  await expect.poll(async () => {
    const nodes = await device.inputObservation(res);
    const { connecting } = gameConnectionState(nodes);
    // 连接遮罩会使仍挂载的侧栏不可见；重连中的缺失不是关闭证据。
    return connecting || nodes.some(node => node.res === res);
  }, { timeout: 45_000, intervals: [250] }).toBe(false);
}

/** Return the same complete tree that established connection readiness. */
async function connectedObservation(device: AndroidDevice, stableMs = 0,
  observe = () => gameNodes(device)): Promise<{
  nodes: NativeNode[]; recovered: boolean;
}> {
  const initial = await observe();
  if (!gameConnectionState(initial).connecting && !stableMs) return { nodes: initial, recovered: false };
  let availableSince = 0;
  let nodes = initial;
  await expect.poll(async () => {
    nodes = await observe();
    const { connecting } = gameConnectionState(nodes);
    if (connecting) availableSince = 0;
    else if (!availableSince) availableSince = Date.now();
    return !connecting && Date.now() - availableSince >= Math.max(1_000, stableMs);
  }, { timeout: 120_000, intervals: [250] }).toBe(true);
  return { nodes, recovered: true };
}

/**
 * 根据两次一致的真实布局执行一次原生点击。
 * @param device - 专用模拟器连接。
 * @param res - 与 Web 共用的 testID。
 * @param nativeInput - 短时提示使用现有驱动点击，避免启动 shell 输入进程耗尽显示时间。
 * @param pointForTarget - 在最新稳定目标内选择落点；遮罩使用避开面板的边缘。
 */
export async function gameTap(device: AndroidDevice, res: string, _nativeInput = false,
  onTap?: (point: Readonly<{ x: number; y: number }>) => void,
  observe = () => gameNodes(device),
  pointForTarget?: (bounds: ScreenshotBounds) => { x: number; y: number }): Promise<void> {
  console.log(`IOS > 游戏点击 ${res}`);
  let previous: NativeNode | undefined;
  let stabilityStarted = false;
  let deadline = Date.now() + 45_000;
  let node: NativeNode;
  for (;;) {
    // Do not put the independent 120s connection recovery inside a 45s target poll.
    // Every recovered connection starts a new pair of actual target observations.
    const observation = await connectedObservation(device, 0, observe);
    if (observation.recovered) {
      previous = undefined;
      stabilityStarted = false;
      deadline = Date.now() + 45_000;
    }
    const candidates = observation.nodes.filter(candidate => candidate.res === res && candidate.visible !== false);
    if (candidates.length > 1) throw new Error(`${res} 必须是唯一可见目标`);
    const current = candidates[0];
    if (current && !stabilityStarted) {
      stabilityStarted = true;
      deadline = Date.now() + 45_000;
    }
    if (current && previous) {
      try {
        expect(previous.enabled, '第一次观测目标必须可点击').toBe(true);
        expect(current.enabled, '第二次观测目标必须可点击').toBe(true);
        expect(current.bounds).toEqual(previous.bounds);
        node = current;
        break;
      } catch (error) {
        if (Date.now() >= deadline) throw error;
      }
    } else if (!current) {
      if (Date.now() >= deadline) throw new Error(`${res} 应可见`);
    }
    // A vanished target cannot contribute a sample to the later stable pair.
    previous = current;
    await delay(current ? 200 : 250);
  }
  const { x, y, width, height } = node.bounds;
  const point = pointForTarget?.(node.bounds)
    ?? { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
  if (![point.x, point.y].every(Number.isFinite) || point.x < x || point.y < y
    || point.x >= x + width || point.y >= y + height) throw new Error('点击位置必须位于当前真实目标内');
  onTap?.({ ...point });
  await device.input.tap(point);
  console.log(`IOS > 游戏已点击 ${res}`);
}

/** 聊天、牌谱入口和关闭遮罩使用同一次轻量原生观测；保留两样本、重连恢复和错误即失败规则。 */
export async function gameTapCurrent(device: AndroidDevice, res: string,
  pointForTarget?: (bounds: ScreenshotBounds) => { x: number; y: number },
  onTap?: (point: Readonly<{ x: number; y: number }>) => void): Promise<void> {
  await device.prepareTransientCapture();
  await gameTap(device, res, false, onTap, async () => {
    const observation = await device.inputObservation(res);
    // 39614829016 的牌谱按钮在真实 XML 和截图中可见，但 predicate 查询持续为空。
    // 只有目标缺失且没有连接遮挡时，改读本轮完整原生树；不复用旧坐标或补造节点。
    if (observation.some(node => node.res === res) || gameConnectionState(observation).connecting)
      return observation;
    return gameNodes(device);
  }, pointForTarget);
}

/** 返回确认连接正常的同一份原生树，并标明是否经历重连恢复。 */
export async function gameConnectedObservation(device: AndroidDevice): Promise<{
  nodes: NativeNode[]; recovered: boolean;
}> {
  return connectedObservation(device, 0);
}
