// 验证摊牌双方的真实三牌结构；皇冠覆盖AX可见性时仍保留原始属性。
import type { NativeNode } from './native-device';
import type { ScreenshotBounds } from './screenshot';
import { contains, horizontallyInside, horizontallySpread, screenBounds, type Screen } from './zhajinhua-region-geometry';

const one = <T>(items: T[], message: string): T => {
  if (items.length !== 1) throw new Error(message);
  return items[0];
};
const hasSprite = (node: NativeNode) => node.children?.some(child => child.res === 'sprite-image-content');
const sameBounds = (a: ScreenshotBounds, b: ScreenshotBounds) => JSON.stringify(a) === JSON.stringify(b);

function showdownPlayer(nodes: NativeNode[], id: string): NativeNode {
  const marker = `zhajinhua-player-container-${id}`;
  return one(nodes.filter(node => node.visible !== false)
    .filter(node => node.res === marker || node.res === `${marker}-operating`), '摊牌必须有唯一当前可见玩家');
}

function showdownWrappers(children: NativeNode[]): NativeNode[] {
  const wrappers = children.filter(node => !node.res && node.enabled === true && hasSprite(node));
  if (wrappers.length !== 3) throw new Error('双方摊牌都必须有三张真实牌面包装');
  return wrappers;
}

function cardBounds(wrapper: NativeNode, container: NativeNode, screen: Screen): ScreenshotBounds {
  const parts = ['sprite-image-content', 'sprite-image-container', 'sprite-image-clipper']
    .map(res => one(wrapper.children.filter(child => child.res === res), '摊牌必须保留完整牌面内容与裁切结构'));
  const bounds = parts[0].bounds;
  const containment = [
    [parts[2].bounds, bounds], [wrapper.bounds, parts[2].bounds],
    [wrapper.bounds, bounds], [container.bounds, bounds], [screenBounds(screen), wrapper.bounds],
  ];
  if (!sameBounds(parts[1].bounds, bounds) || !containment.every(([outer, inner]) => contains(outer, inner)))
    throw new Error('摊牌牌面必须完整位于真实包装、容器和屏幕内');
  return bounds;
}

function cardTypeText(node: NativeNode): boolean {
  return !!node.text && node.res === node.text && !/^\d+$/.test(node.text);
}

function requireCardType(children: NativeNode[], first: ScreenshotBounds, player: NativeNode, screen: Screen): void {
  one(children.filter(cardTypeText)
    .filter(node => node.bounds.y >= first.y + first.height && node.bounds.height <= player.bounds.height / 3)
    .filter(node => horizontallyInside(node.bounds, player.bounds) && contains(screenBounds(screen), node.bounds)),
  '双方摊牌都必须保留完整牌型文字');
}

function crownImage(node: NativeNode): boolean | undefined {
  return node.children?.some(child => child.clazz === 'XCUIElementTypeImage' && child.visible === true
    && sameBounds(child.bounds, node.bounds));
}

function requireCrown(children: NativeNode[], container: NativeNode, screen: Screen): void {
  one(children.filter(node => !node.res && node.visible === true && node.enabled === true)
    .filter(node => contains(node.bounds, container.bounds) && contains(screenBounds(screen), node.bounds))
    .filter(crownImage), '皇冠特效必须有覆盖己方手牌的真实可见图像层');
}

function requireHiddenWinner(id: string, winner: string, children: NativeNode[]): void {
  if (id !== winner || !children.some(node => node.res === 'player_victory_container' && node.enabled === true))
    throw new Error('隐藏摊牌必须属于当前获胜玩家的皇冠特效');
}

function verifyPlayer(nodes: NativeNode[], id: string, winner: string, screen: Screen): void {
  const player = showdownPlayer(nodes, id), children = player.children || [];
  const container = one(children.filter(node => node.res === 'player_cards_container'
    && node.enabled === true), '双方都必须有完整摊牌容器');
  const wrappers = showdownWrappers(children);
  const cards = wrappers.map(wrapper => cardBounds(wrapper, container, screen)).sort((a, b) => a.x - b.x);
  requireSpread(cards);
  requireCardType(children, cards[0], player, screen);
  verifyVisibility(id, winner, children, container, wrappers, screen);
}

function requireSpread(cards: ScreenshotBounds[]): void {
  if (!horizontallySpread(cards)) throw new Error('摊牌三张牌必须完整水平展开');
}

function verifyVisibility(id: string, winner: string, children: NativeNode[], container: NativeNode,
  wrappers: NativeNode[], screen: Screen): void {
  if (container.visible !== false && !wrappers.some(node => node.visible === false)) return;
  requireHiddenWinner(id, winner, children);
  requireCrown(children, container, screen);
}

/** Fabric 把牌面包装展平到玩家子树。只能在指定的可见双方玩家内
 * 读取容器和三张完整牌；己方皇冠特效遮挡AX时还须有实际可见的图像层。
 * 不把隐藏节点用于点击，也不更改节点的visible值。
 */
export function requireZhajinhuaShowdownPlayers(nodes: NativeNode[], winner: string, loser: string, screen: Screen): void {
  if (winner === loser) throw new Error('摊牌双方必须是不同玩家');
  for (const id of [winner, loser]) verifyPlayer(nodes, id, winner, screen);
}
