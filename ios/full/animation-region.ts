import { texasRaiseRegion } from './texas-raise-region';
import { texasOperationRegion, texasPlayerActionRegion } from './texas-action-region';
import { texasShowdownRegion } from './texas-showdown-region';
import { zhajinhuaBetRegion } from './zhajinhua-bet-region';
import { nativePregamePanelBounds } from './pregame-panel-region';
import { nativeApplicationsPanelBounds } from './applications-region';
import { zhajinhuaOperationRegion } from './zhajinhua-operation-region';
import type { NativeDevice, NativeNode } from './native-device';
import { nativeProfilePanelBounds } from './profile-region';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';
import { slotNoEnergyRegions } from './slot-regions';
import matchingMaskReference from './matching-mask-reference.json' with { type: 'json' };

/** Preserve the reviewed exclusion across rotation phases. Native accessibility
 * bounds rotate with the image, while the rendered circle stays in this box.
 */
export function matchingModalMotionMasks(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotMask[] {
  const panel = matchingModalBounds(nodes, screen);
  if ((['x', 'y', 'width', 'height'] as const).some(key => panel[key] !== matchingMaskReference.panel[key])) {
    throw new Error('匹配弹窗原生布局偏离已审查基准');
  }
  const spinner = nodes.find(node => node.clazz === 'XCUIElementTypeImage'
    && node.res?.endsWith('/icon_home_load@3x.png'));
  const fixed = matchingMaskReference.spinner;
  if (!spinner || Math.abs(spinner.bounds.x + spinner.bounds.width / 2 - fixed.x - fixed.width / 2) > 2
    || Math.abs(spinner.bounds.y + spinner.bounds.height / 2 - fixed.y - fixed.height / 2) > 2) {
    throw new Error('匹配旋转图标中心偏离已审查范围');
  }
  const countdown = nodes.find(node => node.res === 'game-matching-countdown-text')!;
  return [
    { ...countdown.bounds, reason: '独立匹配计时数字' },
    { ...fixed, reason: '已审查的完整旋转图标固定范围；animation-17 独立验证图标画面与运动' },
  ];
}

/** Endpoint exclusions originate in the screen tree; retain the true crop offset. */
export function endpointMasksInRegion(masks: ScreenshotMask[], region: ScreenshotBounds): ScreenshotMask[] {
  return masks.map(mask => ({ ...mask, x: mask.x - region.x, y: mask.y - region.y }));
}

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

/** Bound the full rotating image by stable native dialog controls, not the
 * instantaneous transformed image rectangle or an Android screen proportion.
 */
export function matchingSpinnerRegion(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotBounds {
  const panel = matchingModalBounds(nodes, screen);
  const countdown = nodes.find(node => node.res === 'game-matching-countdown-text')!;
  const cancel = nodes.find(node => node.res === 'quick-start-room-cancel')!;
  const icon = nodes.find(node => node.clazz === 'XCUIElementTypeImage'
    && node.res?.endsWith('/icon_home_load@3x.png'));
  const top = Math.ceil(countdown.bounds.y + countdown.bounds.height) + 1;
  const bottom = Math.floor(cancel.bounds.y) - 1;
  const region = { x: panel.x, y: top, width: panel.width, height: bottom - top };
  if (!icon || region.height <= 0 || icon.bounds.x < region.x || icon.bounds.y < top
    || icon.bounds.x + icon.bounds.width > region.x + region.width
    || icon.bounds.y + icon.bounds.height > bottom) throw new Error('匹配旋转图标必须完整位于原生内容区内');
  return region;
}

/** The audio root is hidden in XCTest; its visible content container surrounds
 * both tips and the microphone. Preserve the entire sheet, including safe area.
 */
export function nativeAudioPanelBounds(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotBounds {
  const controls = ['in-game-audio-top-tips', 'in-game-audio-microphone-button', 'in-game-audio-bottom-tips']
    .map(res => nodes.find(node => node.res === res && node.visible !== false));
  if (controls.some(node => !node)) throw new Error('语音面板缺少可见提示或麦克风控件');
  const containers = nodes.filter(node => node.visible !== false && node.clazz === 'XCUIElementTypeOther'
    && node.bounds.x === 0 && node.bounds.width === screen.width
    && node.bounds.y > 0 && node.bounds.height > 0 && node.bounds.y + node.bounds.height <= screen.height
    && controls.every(control => {
      const a = node.bounds, b = control!.bounds;
      return b.width > 0 && b.height > 0 && a.x <= b.x && a.y <= b.y
        && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
    })).sort((a, b) => a.bounds.height - b.bounds.height);
  if (!containers.length) throw new Error('找不到完整语音原生内容面板，不能只截麦克风或全屏遮罩');
  return { ...containers[0].bounds };
}

/** 已有原生标记的面板用实际 bounds，包含 iOS safe area 和真实布局位置。 */
export function nativeChatPanelBounds(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotBounds {
  const markers = ['in-game-chat-send-message', '-in-game-chat-record-tab', 'in-game-chat-content-container'];
  const controls = markers
    .map(res => nodes.find(node => node.res === res && node.visible !== false));
  const missing = markers.filter((_, index) => !controls[index]);
  if (missing.length) throw new Error(`聊天面板缺少可见控件：${missing.join(', ')}`);
  const containers = nodes.filter(node => node.visible !== false && node.clazz === 'XCUIElementTypeOther'
    && node.bounds.x === 0 && node.bounds.width === screen.width && node.bounds.y > 0
    && node.bounds.height > 0 && node.bounds.y + node.bounds.height <= screen.height
    && controls.every(control => {
      const a = node.bounds, b = control!.bounds;
      return b.width > 0 && b.height > 0 && a.x <= b.x && a.y <= b.y
        && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
    })).sort((a, b) => a.bounds.height - b.bounds.height);
  if (!containers.length) throw new Error('找不到完整聊天原生面板');
  return { ...containers[0].bounds };
}

export function nativeReviewPanelBounds(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotBounds {
  const controls = ['review-board-description-text', 'review-board-slider', 'review-board-share-button']
    .map(res => nodes.find(node => node.res === res && node.visible !== false));
  if (controls.some(node => !node)) throw new Error('空牌谱侧栏缺少可见说明、滑块或分享按钮');
  const panel = nodes.find(node => node.visible !== false && node.clazz === 'XCUIElementTypeOther'
    && node.bounds.x > 0 && node.bounds.y === 0 && node.bounds.height === screen.height
    && node.bounds.x + node.bounds.width === screen.width
    && controls.every(control => control!.bounds.x >= node.bounds.x
      && control!.bounds.x + control!.bounds.width <= screen.width));
  if (!panel) throw new Error('找不到完整原生牌谱侧栏');
  return { ...panel.bounds };
}

export function nativePersonalLeaderboardBounds(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotBounds {
  const controls = ['personal-leader-board-nickname', 'personal-leader-board-round',
    'personal-leader-board-profit', 'personal-leader-board-close-button']
    .map(res => nodes.find(node => node.res === res && node.visible !== false));
  if (controls.some(node => !node)) throw new Error('个人排行榜缺少可见身份、数据或关闭按钮');
  const panel = nodes.find(node => node.visible !== false && node.clazz === 'XCUIElementTypeOther'
    && node.bounds.x === 0 && node.bounds.y === 0 && node.bounds.height === screen.height
    && node.bounds.width > 0 && node.bounds.width < screen.width
    && controls.every(control => control!.bounds.x >= 0
      && control!.bounds.x + control!.bounds.width <= node.bounds.width));
  if (!panel) throw new Error('找不到完整个人排行榜原生侧栏');
  return { ...panel.bounds };
}

/** CommonAlert's named root is a full-screen touch layer. Its actual zooming
 * background is the smallest native container enclosing message and buttons.
 */
export function nativeAlertPanelBounds(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotBounds {
  const message = nodes.find(node => node.visible !== false && node.res === 'common-alert-message');
  const buttons = nodes.filter(node => node.visible !== false
    && /^common-alert-button-(?!text-)/.test(node.res || ''));
  if (!message || !buttons.length) throw new Error('原生错误弹窗必须包含可见消息和按钮');
  const controls = [message, ...buttons];
  const panel = nodes.filter(node => node.visible !== false && node.clazz === 'XCUIElementTypeOther'
    && node.bounds.x > 0 && node.bounds.y > 0 && node.bounds.width > 0 && node.bounds.height > 0
    && node.bounds.x + node.bounds.width < screen.width && node.bounds.y + node.bounds.height < screen.height
    && controls.every(control => {
      const a = node.bounds, b = control.bounds;
      return b.width > 0 && b.height > 0 && b.x >= a.x && b.y >= a.y
        && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
    })).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0];
  if (!panel) throw new Error('找不到完整原生错误弹窗背景');
  const b = panel.bounds, x = Math.max(0, b.x - 4), y = Math.max(0, b.y - 4);
  return { x, y, width: Math.min(screen.width, b.x + b.width + 4) - x,
    height: Math.min(screen.height, b.y + b.height + 4) - y };
}

/** The legacy visible-marker is transparent. The actual shared buy-in panel
 * has a visible title, confirmation and close button inside one native card.
 */
export function nativeBuyInPanelBounds(nodes: NativeNode[], screen: { width: number; height: number }): ScreenshotBounds {
  const controls = ['buy-in-title', 'buy-in-close-button', 'buy-in-confirm-button']
    .map(res => nodes.find(node => node.res === res && node.visible !== false));
  if (controls.some(node => !node)) throw new Error('买入弹窗缺少可见标题或按钮');
  const panel = nodes.filter(node => node.clazz === 'XCUIElementTypeOther' && node.visible !== false
    && node.bounds.width > 0 && node.bounds.height > 0
    && node.bounds.width * node.bounds.height < screen.width * screen.height
    && controls.every(control => {
      const a = node.bounds, b = control!.bounds;
      return a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height;
    })).sort((a, b) => a.bounds.width * a.bounds.height - b.bounds.width * b.bounds.height)[0];
  if (!panel) throw new Error('找不到完整原生买入弹窗');
  const b = panel.bounds, x = Math.max(0, b.x - 4), y = Math.max(0, b.y - 4);
  return { x, y, width: Math.min(screen.width, b.x + b.width + 4) - x,
    height: Math.min(screen.height, b.y + b.height + 4) - y };
}

export function animationRegion(name: string, before: NativeNode[], after: NativeNode[],
  device: Pick<NativeDevice, 'screenSize'>, fallback: ScreenshotBounds): { bounds: ScreenshotBounds; source: string } {
  if (/^texas-holdem-(?:own-profile|opponent-profile-\d+)-(?:enter|exit)$/.test(name)) return {
    bounds: nativeProfilePanelBounds(name.endsWith('-exit') ? before : after, device.screenSize),
    source: 'native-complete-profile-card',
  };
  const pregame = /^(?:texas-holdem|zhajinhua)-(theme|renew)-(?:enter|exit)$/.exec(name);
  if (pregame) return {
    bounds: nativePregamePanelBounds(pregame[1] as 'theme' | 'renew', name.endsWith('-exit') ? before : after,
      device.screenSize), source: 'native-complete-pregame-panel',
  };
  if (name === 'zhajinhua-operation-buttons') return {
    bounds: zhajinhuaOperationRegion(before, after, device.screenSize), source: 'native-complete-operation-controls',
  };
  if (name === 'texas-operation-buttons') return {
    bounds: texasOperationRegion(before, after, device.screenSize), source: 'native-complete-texas-operation-controls',
  };
  if (name === 'texas-showdown') return {
    bounds: texasShowdownRegion(before, after, device.screenSize), source: 'native-complete-showdown-banner-and-cards',
  };
  if (/^texas-player-action-(call|raise|check|fold)$/.test(name)) return {
    bounds: texasPlayerActionRegion(name, before, after, device.screenSize), source: 'native-acting-player-complete-action-label',
  };
  if (name === 'zhajinhua-quick-raise') return {
    bounds: zhajinhuaBetRegion(before, after, device.screenSize), source: 'native-acting-player-bet-panel-and-coin',
  };
  if (/^(?:texas-holdem|zhajinhua)-buy_in-(?:enter|exit)$/.test(name)) return {
    bounds: nativeBuyInPanelBounds(name.endsWith('-exit') ? before : after, device.screenSize),
    source: 'native-buy-in-content-container',
  };
  if (/^(?:texas-holdem|zhajinhua)-buy-in-applications-(?:enter|exit)$/.test(name)) return {
    bounds: nativeApplicationsPanelBounds(name.endsWith('-exit') ? before : after, device.screenSize),
    source: 'native-complete-applications-card',
  };
  if (/^(?:texas-holdem-raise-bet-enter|texas-raise-slider)$/.test(name)) return {
    bounds: texasRaiseRegion(after, device.screenSize), source: 'native-raise-slider-and-buttons',
  };
  if (/^texas-alert-(?:retry|balance|auth)-(?:enter|exit)$/.test(name)) return {
    bounds: nativeAlertPanelBounds(name.endsWith('-exit') ? before : after, device.screenSize),
    source: 'native-common-alert-background',
  };
  // The preflop caller has already required the current self player's two
  // semantic back cards and derived this complete pair geometry.
  if (name === 'texas-preflop-cards') return { bounds: fallback, source: 'native-self-player-card-pair' };
  if (/^texas-(?:flop|turn|river)-cards$/.test(name)) return {
    bounds: fallback, source: 'native-community-card-slots',
  };
  if (/^zhajinhua-(?:deal|flip)-cards$/.test(name)) return {
    bounds: fallback, source: 'native-self-player-three-card-slots',
  };
  if (/^texas-holdem-personal-leaderboard-/.test(name)) return {
    bounds: nativePersonalLeaderboardBounds(name.endsWith('-exit') ? before : after, device.screenSize),
    source: 'native-personal-leaderboard-container',
  };
  if (/^(?:texas-holdem|zhajinhua)-chat-(?:enter|exit)$/.test(name)) return {
    bounds: nativeChatPanelBounds(name.endsWith('-exit') ? before : after, device.screenSize),
    source: 'native-chat-content-container',
  };
  if (/^(?:texas-holdem|zhajinhua)-game-record-/.test(name)) return {
    bounds: nativeReviewPanelBounds(name.endsWith('-exit') ? before : after, device.screenSize),
    source: 'native-review-content-container',
  };
  if (/^texas-holdem-voice-/.test(name)) return {
    bounds: nativeAudioPanelBounds(name.endsWith('-exit') ? before : after, device.screenSize),
    source: 'native-audio-content-container',
  };
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
