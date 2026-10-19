import { expect } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from './native-device';
import type { ScreenshotBounds } from './screenshot';

export type NativeNode = { res?: string; text?: string; enabled?: boolean; checked?: boolean;
  bounds: ScreenshotBounds; children?: NativeNode[] };

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
  await expect(async () => {
    found = (await gameNodes(device)).find(node => node.res === res && (text === undefined || node.text === text));
    expect(found, `${res} 应可见`).toBeDefined();
  }).toPass({ timeout: 45_000, intervals: [250] });
  return found!;
}

/**
 * 等待游戏弹层完全移出屏幕。
 * @param device - 专用模拟器连接。
 * @param res - 弹层标记。
 */
export async function gameGone(device: AndroidDevice, res: string): Promise<void> {
  await expect.poll(async () => (await gameNodes(device)).some(node => node.res === res),
    { timeout: 45_000, intervals: [250] }).toBe(false);
}

/** 等待房间重连遮罩退去并确认牌桌至少一秒内持续可操作。
 * @param device - 专用模拟器连接。
 * @param stableMs - 指定入口需要额外连续无重连遮罩的时间。
 */
export async function gameConnected(device: AndroidDevice, stableMs = 0): Promise<void> {
  const initial = await gameNodes(device);
  if (!stableMs && !initial.some(node => /Connecting\.\.\./.test(node.text || ''))) return;
  let availableSince = 0;
  await expect.poll(async () => {
    const connecting = (await gameNodes(device)).some(node => /Connecting\.\.\./.test(node.text || ''));
    if (connecting) availableSince = 0;
    else if (!availableSince) availableSince = Date.now();
    return !connecting && Date.now() - availableSince >= Math.max(1_000, stableMs);
  }, { timeout: 120_000, intervals: [250] }).toBe(true);
}

/**
 * 根据两次一致的真实布局点击控件，使用 adb 输入避免驱动等待循环动画空闲。
 * @param device - 专用模拟器连接。
 * @param res - 与 Web 共用的 testID。
 * @param nativeInput - 短时提示使用现有驱动点击，避免启动 shell 输入进程耗尽显示时间。
 */
export async function gameTap(device: AndroidDevice, res: string, _nativeInput = false): Promise<void> {
  console.log(`IOS > 游戏点击 ${res}`);
  await gameConnected(device);
  let previous: ScreenshotBounds | undefined;
  let node: NativeNode;
  await expect(async () => {
    node = await gameReady(device, res);
    const before = previous;
    previous = node.bounds;
    expect(node.enabled).not.toBe(false);
    expect(previous).toEqual(before);
  }).toPass({ timeout: 45_000, intervals: [200] });
  const { x, y, width, height } = node!.bounds;
  const point = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
  await device.input.tap(point);
}
