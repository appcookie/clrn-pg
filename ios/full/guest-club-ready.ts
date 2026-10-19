import type { NativeDevice, NativeNode } from './native-device';
import { fullyInside, nativeViewport } from './native-viewport';

const tabIdentifiers = ['club_tab_room', 'club_tab_my_club'];

/** iOS exposes the club contents, while club-tab-screen is an invisible mount. */
export function assertClubReady(nodes: NativeNode[], screen: { width: number; height: number }, signIn: boolean) {
  if (typeof signIn !== 'boolean') throw new Error('俱乐部就绪检查必须明确声明登录状态。');
  if (nodes.some(node => node.visible !== false && node.clazz === 'XCUIElementTypeAlert')) throw new Error('系统弹窗遮挡俱乐部页面。');
  if (signIn && nodes.some(node => node.res === 'not-sign-in-container' && node.visible !== false)) throw new Error('已登录俱乐部不应显示游客登录横幅。');
  const identifiers = signIn ? tabIdentifiers : [...tabIdentifiers, 'not-sign-in-container'];
  for (const res of identifiers) {
    // Only the visible flat list may prove readiness. Hidden nested mount points
    // are not a substitute for the club tabs and the actual guest sign-in banner.
    const matches = nodes.filter(node => node.res === res && node.visible !== false);
    if (matches.length !== 1) throw new Error(`俱乐部须显示唯一真实控件：${res}`);
    const geometry = nativeViewport(nodes, matches[0], { x: 0, y: 0, ...screen });
    if (!fullyInside(geometry.node.bounds, geometry.viewport)) throw new Error(`俱乐部控件被裁切：${res}`);
  }
}

export async function waitForGuestClubReady(device: NativeDevice) {
  await waitForClubReady(device, { signIn: false });
}

export function assertGuestClubReady(nodes: NativeNode[], screen: { width: number; height: number }) {
  assertClubReady(nodes, screen, false);
}

export async function waitForClubReady(device: NativeDevice, { signIn }: { signIn: boolean }) {
  if (typeof signIn !== 'boolean') throw new Error('俱乐部就绪检查必须明确声明登录状态。');
  for (const res of signIn ? tabIdentifiers : [...tabIdentifiers, 'not-sign-in-container']) await device.wait({ res });
  assertClubReady(await device.nodes(), device.screenSize, signIn);
}
