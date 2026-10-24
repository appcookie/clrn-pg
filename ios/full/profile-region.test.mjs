import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeProfilePanelBounds, ownProfileIdentityMask } from './profile-region.ts';
const screen = { width: 1178, height: 2556 };
const node = (res, bounds, text) => ({ res, bounds, text, visible: true, clazz: 'XCUIElementTypeOther', children: [] });
const panel = node(undefined, { x: 71, y: 693, width: 1036, height: 1170 });
const controls = [node('player-profile-popup-close', { x: 1040, y: 738, width: 37, height: 36 }),
  node('player-profile-nickname', { x: 341, y: 741, width: 280, height: 57 }, 'Testing User'),
  node('PlayerStatisticComponent_List', { x: 116, y: 1191, width: 946, height: 639 }),
  node('player-profile-id', { x: 341, y: 819, width: 451, height: 45 }, 'ID: abcdef12')];
test('玩家资料截图保留完整原生卡片和统计底部，不采用全屏遮罩或裁断列表的容器', () => {
  const nodes = [node('screen-mask-touch-to-close', { x: 0, y: 0, ...screen }), panel, ...controls];
  assert.deepEqual(nativeProfilePanelBounds(nodes, screen), { x: 67, y: 689, width: 1044, height: 1178 });
  assert.throws(() => nativeProfilePanelBounds(nodes.filter(n => n !== panel), screen), /完整原生卡片/);
  assert.throws(() => nativeProfilePanelBounds([panel, ...controls.slice(0, 2)], screen), /完整统计列表/);
  assert.throws(() => nativeProfilePanelBounds([{ ...panel, bounds: { ...panel.bounds, height: 600 } }, ...controls], screen), /完整原生卡片/);
});
test('本人资料端点仅排除实际单行ID，头像统计大区域或隐藏ID均不得遮蔽', () => {
  const metadata = [node('player-profile-level', { x: 632, y: 744, width: 160, height: 51 }, 'Lv 1'),
    node('player-profile-balance', { x: 401, y: 888, width: 97, height: 54 }, '10000')];
  const nodes = [panel, ...controls, ...metadata];
  assert.deepEqual(ownProfileIdentityMask(nodes, screen)[0], { ...controls[3].bounds,
    reason: '本轮实际测试账号 ID；昵称、等级、余额和统计继续比较' });
  for (const bad of [{ ...controls[3], visible: false }, { ...controls[3], text: 'nickname' },
    { ...controls[3], text: 'ID:\nabcdef12' },
    { ...controls[3], bounds: { ...controls[3].bounds, height: 600 } },
    { ...controls[3], bounds: { ...controls[3].bounds, y: 888 } }]) {
    assert.throws(() => ownProfileIdentityMask([panel, ...controls.slice(0, 3), bad, ...metadata], screen), /ID/);
  }
});
