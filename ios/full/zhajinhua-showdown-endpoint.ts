// 验证摊牌双方的真实三牌结构；皇冠覆盖AX可见性时仍保留原始属性。
import type { NativeNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';

const contains = (a: ScreenshotBounds, b: ScreenshotBounds) => b.width > 0 && b.height > 0
  && b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height;
const one = <T>(items: T[], message: string): T => {
  if (items.length !== 1) throw new Error(message);
  return items[0];
};

/** Fabric 把牌面包装展平到玩家子树。只能在指定的可见双方玩家内
 * 读取容器和三张完整牌；己方皇冠特效遮挡AX时还须有实际可见的图像层。
 * 不把隐藏节点用于点击，也不更改节点的visible值。
 */
export function requireZhajinhuaShowdownPlayers(nodes: NativeNode[], winner: string, loser: string,
  screen: { width: number; height: number }): void {
  if (winner === loser) throw new Error('摊牌双方必须是不同玩家');
  for (const id of [winner, loser]) {
    const marker = `zhajinhua-player-container-${id}`;
    const player = one(nodes.filter(node => node.visible !== false
      && (node.res === marker || node.res === `${marker}-operating`)), '摊牌必须有唯一当前可见玩家');
    const children = player.children || [];
    const container = one(children.filter(node => node.res === 'player_cards_container'
      && node.enabled === true), '双方都必须有完整摊牌容器');
    const wrappers = children.filter(node => !node.res && node.enabled === true
      && node.children?.some(child => child.res === 'sprite-image-content'));
    if (wrappers.length !== 3) throw new Error('双方摊牌都必须有三张真实牌面包装');
    const cards = wrappers.map(wrapper => {
      const parts = ['sprite-image-content', 'sprite-image-container', 'sprite-image-clipper']
        .map(res => one(wrapper.children.filter(child => child.res === res), '摊牌必须保留完整牌面内容与裁切结构'));
      const bounds = parts[0].bounds;
      if (JSON.stringify(parts[1].bounds) !== JSON.stringify(bounds)
        || !contains(parts[2].bounds, bounds) || !contains(wrapper.bounds, parts[2].bounds)
        || !contains(wrapper.bounds, bounds) || !contains(container.bounds, bounds)
        || !contains({ x: 0, y: 0, ...screen }, wrapper.bounds)) throw new Error('摊牌牌面必须完整位于真实包装、容器和屏幕内');
      return bounds;
    }).sort((a, b) => a.x - b.x);
    if (cards.some(card => Math.abs(card.y - cards[0].y) > 2
      || Math.abs(card.width - cards[0].width) > 6 || Math.abs(card.height - cards[0].height) > 2)
      || cards.slice(1).some((card, i) => card.x - cards[i].x < cards[0].width * .6
        || card.x - cards[i].x > cards[0].width * .85)) throw new Error('摊牌三张牌必须完整水平展开');
    one(children.filter(node => node.text && node.res === node.text && !/^\d+$/.test(node.text)
      && node.bounds.y >= cards[0].y + cards[0].height && node.bounds.height <= player.bounds.height / 3
      && node.bounds.x >= player.bounds.x && node.bounds.x + node.bounds.width <= player.bounds.x + player.bounds.width
      && contains({ x: 0, y: 0, ...screen }, node.bounds)),
    '双方摊牌都必须保留完整牌型文字');
    if (container.visible === false || wrappers.some(node => node.visible === false)) {
      if (id !== winner || !children.some(node => node.res === 'player_victory_container'
        && node.enabled === true)) throw new Error('隐藏摊牌必须属于当前获胜玩家的皇冠特效');
      one(children.filter(node => !node.res && node.visible === true && node.enabled === true
        && contains(node.bounds, container.bounds) && contains({ x: 0, y: 0, ...screen }, node.bounds)
        && node.children?.some(child => child.clazz === 'XCUIElementTypeImage' && child.visible === true
          && JSON.stringify(child.bounds) === JSON.stringify(node.bounds))), '皇冠特效必须有覆盖己方手牌的真实可见图像层');
    }
  }
}
