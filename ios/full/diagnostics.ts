import { recentNativeCrashes } from './native-crash';
import type { NativeDevice } from './native-device';
import type { TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

type DiagnosticNode = { res?: string; clazz?: string; bounds?: unknown; enabled?: boolean; checked?: boolean; visible?: boolean;
  secure?: boolean; text?: string; children?: DiagnosticNode[] };

/** nodes() 同时返回父节点及其子节点；先建立整个对象图的敏感上下文，再处理每个根。 */
function sensitiveNodes(nodes: DiagnosticNode[]) {
  const secrets = new Set<DiagnosticNode>();
  const containers = new Set<DiagnosticNode>();
  const visit = (node: DiagnosticNode, inherited = false): boolean => {
    const secret = inherited || !!node.secure || /TextField|TextView|Keyboard/.test(node.clazz || '')
      || (node.res !== 'in-game-audio-microphone-button'
        && /password|username|email|phone|confirmation-input|token/i.test(node.res || ''));
    if (secret) secrets.add(node);
    const descendants = (node.children || []).map(child => visit(child, secret));
    if (secret || descendants.some(Boolean)) containers.add(node);
    return secret || descendants.some(Boolean);
  };
  for (const node of nodes) visit(node);
  return { secrets, containers };
}

/** 不记录原始 attributes/value，重复出现的输入节点及聚合其内容的祖先也脱敏。 */
export function safeNativeTree(nodes: DiagnosticNode[]): unknown[] {
  const { secrets, containers } = sensitiveNodes(nodes);
  const redact = (node: DiagnosticNode): unknown => ({
    res: containers.has(node) ? '[redacted]' : node.res, clazz: node.clazz, bounds: node.bounds,
    enabled: node.enabled, checked: node.checked, visible: node.visible,
    text: secrets.has(node) || containers.has(node) ? '[redacted]' : node.text,
    children: node.children?.map(redact),
  });
  return nodes.map(redact);
}

/** 失败诊断只保留遮住全部输入和敏感容器的截图；缺失几何信息时拒绝输出截图。 */
export function safeFailureScreenshot(bytes: Buffer, nodes: DiagnosticNode[]): Buffer {
  if (!nodes.length) throw new Error('缺少可验证无障碍树，不能安全保存失败截图');
  const picture = PNG.sync.read(bytes);
  for (const node of sensitiveNodes(nodes).secrets) {
    const bounds = node.bounds as { x: number; y: number; width: number; height: number } | undefined;
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
      || bounds.width <= 0 || bounds.height <= 0) throw new Error('敏感控件缺少有效截图边界');
    const left = Math.max(0, Math.floor(bounds.x) - 2), top = Math.max(0, Math.floor(bounds.y) - 2);
    const right = Math.min(picture.width, Math.ceil(bounds.x + bounds.width) + 2);
    const bottom = Math.min(picture.height, Math.ceil(bounds.y + bounds.height) + 2);
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const offset = (y * picture.width + x) * 4;
      picture.data[offset] = picture.data[offset + 1] = picture.data[offset + 2] = 32;
      picture.data[offset + 3] = 255;
    }
  }
  return PNG.sync.write(picture);
}

/** 在设备关闭前保存脱敏传输快照，再读取截图脱敏所需的原生树。 */
export async function captureFailure(device: NativeDevice, testInfo: TestInfo,
  transport?: () => Promise<unknown>): Promise<void> {
  if (transport) {
    // 只接收 native/transport 的脱敏结果；不能改用会话接口或原始代理日志。
    const snapshot = await transport().catch(() => ({ unavailable: true }));
    await testInfo.attach('failure-transport', { body: JSON.stringify(snapshot),
      contentType: 'application/json' }).catch(() => {});
  }
  const nodes = await device.nodes().catch(() => undefined);
  if (!nodes) {
    if (!device.applicationId) return;
    const crashes = await recentNativeCrashes(device.applicationId).catch(error => ({ diagnosticError: String(error) }));
    await testInfo.attach('native-app-crash-summary', { body: JSON.stringify(crashes),
      contentType: 'application/json' }).catch(() => {});
    return;
  }
  await testInfo.attach('failure-accessibility', { body: JSON.stringify(safeNativeTree(nodes)), contentType: 'application/json' }).catch(() => {});
  await device.nativeScreenshot().then(body => testInfo.attach('failure-screen-redacted', {
    body: safeFailureScreenshot(body, nodes), contentType: 'image/png',
  })).catch(() => {});
}
