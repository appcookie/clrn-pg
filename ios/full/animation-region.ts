import type { NativeDevice, NativeNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';

/** 已有原生标记的面板用实际 bounds，包含 iOS safe area 和真实布局位置。 */
export function animationRegion(name: string, before: NativeNode[], after: NativeNode[],
  device: Pick<NativeDevice, 'screenSize'>, fallback: ScreenshotBounds): { bounds: ScreenshotBounds; source: string } {
  const entries: [RegExp, RegExp][] = [
    [/search-confirmation/, /^confirm-pop-up-image-background$/],
    [/club-more/, /^club-more-popup$/], [/club-rooms-empty/, /^club-rooms-empty-view$/],
    [/slot-popup/, /^slot-machine-view$/], [/slot-no-energy/, /^slot-no-energy-popup-container$/],
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
