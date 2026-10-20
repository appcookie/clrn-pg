import type { NativeNode } from './game-controls';
import type { ScreenshotBounds, ScreenshotMask } from './screenshot';

/** iOS hides background accessibility elements while a modal is open even when
 * their pixels remain visible. Only recover seat guides for masking, never for
 * interaction/readiness, and keep their current-tree identity for panel clipping.
 */
export function screenshotMaskNodes(nodes: NativeNode[]): NativeNode[] {
  const result = new Set(nodes);
  const visited = new Set<NativeNode>();
  const visit = (node: NativeNode) => {
    if (visited.has(node)) return;
    visited.add(node);
    if (/^seat-guide-\d+$/.test(node.res || '') && node.bounds.width > 0 && node.bounds.height > 0) result.add(node);
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return [...result];
}

/** Include the entire vertical arrow travel, not just its layout rectangle. */
export function seatGuideMotionBounds(bounds: ScreenshotBounds): ScreenshotBounds {
  const travel = Math.ceil(bounds.width * 11 / 24);
  const x = Math.floor(bounds.x - 1), y = Math.floor(bounds.y - travel - 1);
  return { x, y, width: Math.ceil(bounds.x + bounds.width + 1) - x,
    height: Math.ceil(bounds.y + bounds.height + travel + 1) - y };
}

/** Background arrows have their own full-motion baselines. Exclude their phase
 * from panel endpoints while retaining every foreground panel pixel.
 */
export function seatGuideBackgroundMasks(nodes: NativeNode[],
  screen: { width: number; height: number }): ScreenshotMask[] {
  const panels = foregroundPanels(nodes, screen);
  return screenshotMaskNodes(nodes).filter(node => /^seat-guide-\d+$/.test(node.res || ''))
    .flatMap(node => visibleMasks({ ...seatGuideMotionBounds(node.bounds),
      reason: `${node.res} 独立箭头动画；前景内容仍比较` }, node, panels));
}

/**
 * 根据前景就绪标记找到实际内容容器；Fabric 可能把背景与弹层压平成兄弟节点。
 * @param nodes - 保留父子关系的可见节点。
 */
export function foregroundPanels(nodes: NativeNode[], screen: { width: number; height: number }): NativeNode[] {
  const markers = new Set(['drawer-menu-item-exit', 'card-rank-list', 'game-settings-close-button',
    'buy-in-title', 'renew-popup-close-button', 'public-leader-board-container', 'review-board-close-button',
    'review-board-description-text', 'in-game-chat-animated-view', 'buy-in-application-list',
    'player-profile-popup-close', 'report-field-input', 'accurate-bet-popup-container', 'raise-bet-popup',
    'in-game-audio-microphone-button', 'report-popup-title', 'BlockPlayerConfirmPopup:title', 'buy-in-review-close-button',
    'view-community-close-button', 'raise-blind-detail', 'auto-rebuy-popup', 'report-pair-play-close-button',
    'personal-leader-board-close-button', 'level-up-close-button', 'common-alert-message', 'in_game_report_message_component']);
  // 摊牌位于头像倒计时之上；即使 Android 将牌面容器裁到头像范围，也必须保留其中的牌面。
  const panels: NativeNode[] = nodes.filter(node => ['base-review-board-container',
    'player_cards_container', 'texas-holdem-player-hole-cards', 'texas-holdem-show-remain-community-card-button'].includes(node.res || '')
    || (node.res === 'showdown-assist-view-container' && node.children?.some(child =>
      child.res === 'showdown-assist-view-strength-text' && child.text))
    || (node.res?.startsWith('texas-holdem-shortcut-raise-button-') && node.res !== 'texas-holdem-shortcut-raise-button-group')
    || node.res?.startsWith('zhajinhua-shortcut-raise-')
    || node.res?.startsWith('texas-holdem-player-action-')
    || node.children?.some(child => child.res === 'player_action_text'));
  for (const marker of nodes.filter(node => markers.has(node.res || ''))) {
    /**
     * 根据原生父子关系定位这个前景控件。
     * @param node - 当前检查的祖先节点。
     */
    const contains = (node: NativeNode): boolean => node === marker || Boolean(node.children?.some(contains));
    const panel = nodes.filter(node => node.bounds.width > 80 && node.bounds.height > 80
      // 半透明触摸背景和整个牌桌不能作为不透明面板。
      && node.bounds.width * node.bounds.height < screen.width * screen.height * 0.95 && contains(node))
      .sort((first, second) => second.bounds.width * second.bounds.height - first.bounds.width * first.bounds.height)[0];
    if (panel && !panels.includes(panel)) panels.push(panel);
  }
  return panels;
}

/**
 * 将背景动态区域裁剪到前景矩形以外，不遮掉面板内的文字、按钮或牌面。
 * @param mask - 需要排除的背景动画或动态文字。
 * @param panel - 覆盖在其上的实际面板边界。
 */
export function subtractPanel(mask: ScreenshotMask, panel: ScreenshotBounds): ScreenshotMask[] {
  const left = Math.max(mask.x, panel.x);
  const top = Math.max(mask.y, panel.y);
  const right = Math.min(mask.x + mask.width, panel.x + panel.width);
  const bottom = Math.min(mask.y + mask.height, panel.y + panel.height);
  if (right <= left || bottom <= top) return [mask];
  return [
    { ...mask, height: top - mask.y },
    { ...mask, y: bottom, height: mask.y + mask.height - bottom },
    { ...mask, y: top, width: left - mask.x, height: bottom - top },
    { ...mask, x: right, y: top, width: mask.x + mask.width - right, height: bottom - top },
  ].filter(part => part.width > 0 && part.height > 0);
}

/**
 * 按圆形按钮实际图案裁剪背景遮罩，透明圆角仍属于会变化的倒计时背景。
 * @param mask - 与按钮相交的背景动态区域。
 * @param bounds - 原生图片节点的椭圆边界。
 */
function subtractRoundButton(mask: ScreenshotMask, bounds: ScreenshotBounds): ScreenshotMask[] {
  if (mask.x >= bounds.x + bounds.width || mask.x + mask.width <= bounds.x
    || mask.y >= bounds.y + bounds.height || mask.y + mask.height <= bounds.y) return [mask];
  const result: ScreenshotMask[] = [];
  const cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2;
  // 按钮 PNG 的首行 alpha 最大仅 229；缩放后的外缘一像素仍混合背景计时。
  const rx = bounds.width / 2 - 1, ry = bounds.height / 2 - 1;
  for (let y = Math.floor(mask.y); y < Math.ceil(mask.y + mask.height); y++) {
    const row = { ...mask, y, height: 1 };
    const relative = (y + 0.5 - cy) / ry;
    if (Math.abs(relative) >= 1) { result.push(row); continue; }
    const radius = rx * Math.sqrt(1 - relative * relative);
    const left = Math.ceil(cx - radius), right = Math.floor(cx + radius);
    result.push(...subtractPanel(row, { x: left, y, width: right - left, height: 1 }));
  }
  return result;
}

/**
 * 仅裁掉覆盖当前节点的面板；面板自己的动态房号仍须排除。
 * @param mask - 当前节点对应的动态区域。
 * @param source - 对应的原生控件。
 * @param panels - 当前前景内容节点。
 */
export function visibleMasks(mask: ScreenshotMask, source: NativeNode, panels: NativeNode[]): ScreenshotMask[] {
  /**
   * 判断节点是否属于当前前景，避免裁掉它自己的动态文字。
   * @param parent - 当前检查的前景节点。
   */
  const contains = (parent: NativeNode): boolean => parent === source || Boolean(parent.children?.some(contains));
  return panels.filter(panel => !contains(panel))
    // 无障碍边界取整后，面板最外一像素仍可能露出背景；买入框实测漏出两个箭头像素。
    .reduce((parts, panel) => {
      const circle = panel.res?.startsWith('zhajinhua-shortcut-raise-') ? panel.children?.[0]?.bounds : undefined;
      if (circle) {
        const withoutCircle = parts.flatMap(part => subtractRoundButton(part, circle));
        return (panel.children || []).filter(child => child.text)
          .reduce((remaining, child) => remaining.flatMap(part => subtractPanel(part, child.bounds)), withoutCircle);
      }
      return parts.flatMap(part => subtractPanel(part, {
      x: panel.bounds.x + 1, y: panel.bounds.y + 1,
      width: panel.bounds.width - 2, height: panel.bounds.height - 2,
      }));
    }, [mask]);
}

/**
 * 网络状态固定在容器右下侧；数字位数会改变容器宽度和内部图标中心，不能按文字中心遮罩。
 * @param bounds - PingScreen 的真实外层边界，包含固定的 70dp 高度和右侧锚点。
 */
export function networkStatusMask(bounds: ScreenshotBounds): ScreenshotMask {
  const scale = bounds.height / 70;
  return { x: bounds.x + bounds.width - 55 * scale, y: bounds.y + bounds.height - 30 * scale,
    width: 50 * scale, height: 24 * scale, reason: '网络延迟数值、图标与前后端延迟比例条' };
}

/**
 * 倒计时数字居中且等宽；固定为两位数字槽，避免 10 变 9 时遮罩自身发生变化。
 * @param bounds - 当前数字的实际边界。
 * @param text - 已确认的一位或两位倒计时数字。
 */
export function countdownMask(bounds: ScreenshotBounds, text: string): ScreenshotMask {
  if (!/^\d{1,2}$/.test(text)) throw new Error('公共牌倒计时必须是一位或两位数字。');
  const width = Math.round(bounds.width / text.length) * 2;
  return { ...bounds, x: Math.round(bounds.x + bounds.width / 2 - width / 2), width,
    reason: 'view-community-cards-countdown' };
}
