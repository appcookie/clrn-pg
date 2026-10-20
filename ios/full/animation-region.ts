import type { NativeDevice, NativeNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';
import { slotNoEnergyRegions } from './slot-regions';

/** The loading marker covers the overlay, including pixels below the raster.
 * Locate the smallest native content container holding all dialog controls.
 */
export function matchingModalBounds(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotBounds {
  const markers = ['game-matching-message', 'game-matching-countdown-text', 'quick-start-room-cancel'];
  const controls = markers.map(res => nodes.find(node => node.res === res));
  if (controls.some(node => !node)) throw new Error('匹配弹窗缺少标题、倒计时或取消按钮');
  const containers = nodes.filter(node => node.clazz === 'XCUIElementTypeOther'
    && node.res !== 'game-matching-loading-view' && node.bounds.width > 0 && node.bounds.height > 0
    && node.bounds.width * node.bounds.height < screen.width * screen.height
    && controls.every(control => {
      const a = node.bounds, b = control!.bounds;
      return a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width
        && a.y + a.height >= b.y + b.height;
    })).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height);
  if (!containers.length) throw new Error('找不到包围匹配内容的真实原生弹窗，不能用全屏遮罩代替');
  const b = containers[0].bounds;
  const x = Math.max(0, Math.floor(b.x) - 4), y = Math.max(0, Math.floor(b.y) - 4);
  const right = Math.min(screen.width, Math.ceil(b.x + b.width) + 4);
  const bottom = Math.min(screen.height, Math.ceil(b.y + b.height) + 4);
  return { x, y, width: right - x, height: bottom - y };
}

/** 已有原生标记的面板用实际 bounds，包含 iOS safe area 和真实布局位置。 */
export function animationRegion(name: string, before: NativeNode[], after: NativeNode[],
  device: Pick<NativeDevice, 'screenSize'>, fallback: ScreenshotBounds): { bounds: ScreenshotBounds; source: string } {
  if (/^hall-matching-modal-/.test(name)) return {
    bounds: matchingModalBounds(name.endsWith('-exit') ? before : after, device.screenSize),
    source: 'native-matching-content-container',
  };
  if (/^slot-no-energy-/.test(name)) return {
    bounds: slotNoEnergyRegions(name.endsWith('-exit') ? before : after, device.screenSize).border,
    source: 'native-slot-no-energy-static-gutter',
  };
  const entries: [RegExp, RegExp][] = [
    [/search-confirmation/, /^confirm-pop-up-image-background$/],
    [/club-more/, /^popup-content-container$/],
    [/club-rooms-empty/, /^club-rooms-empty-view-container$/],
    [/slot-popup/, /\/slot-machine\/.*\/img_panel_(?:bg_head|machine)@3x\.png$/],
    [/drawer-menu/, /^drawer-menu-item-/],
    [/accurate-bet/, /^accurate-bet-popup-container$/], [/raise-bet|raise-slider/, /^raise-bet-popup$/],
    [/card-rank/, /^card-rank-list$/], [/game-rule/, /^game-rule-popup$/],
    [/-theme-|-(?:settings)-/, /^game-settings-popup-container$/],
    [/buy-in-applications/, /^buy-in-application-list$/],
    [/game-record/, /^base-review-board-container$/],
    [/-chat-(?:enter|exit)$/, /^in-game-chat-container$/],
    [/personal-leaderboard/, /^personal-leader-board-container$/],
    [/leaderboard/, /^public-leader-board-container$/],
    [/auto-rebuy/, /^auto-rebuy-popup$/],
  ];
  const matcher = entries.find(([effect]) => effect.test(name))?.[1];
  const nodes = (name.endsWith('-exit') ? before : after).filter(node => matcher?.test(node.res || ''));
  if (!nodes.length) return { bounds: fallback, source: 'relative-layout-fallback-unverified-on-ios' };
  const x = Math.max(0, Math.floor(Math.min(...nodes.map(node => node.bounds.x))) - 4);
  const y = Math.max(0, Math.floor(Math.min(...nodes.map(node => node.bounds.y))) - 4);
  const right = Math.min(device.screenSize.width, Math.ceil(Math.max(...nodes.map(node => node.bounds.x + node.bounds.width))) + 4);
  const bottom = Math.min(device.screenSize.height, Math.ceil(Math.max(...nodes.map(node => node.bounds.y + node.bounds.height))) + 4);
  return { bounds: { x, y, width: right - x, height: bottom - y }, source: `native-identifiers:${matcher}` };
}
