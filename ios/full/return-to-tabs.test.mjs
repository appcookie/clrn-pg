import assert from 'node:assert/strict';
import test from 'node:test';
import { returnToTabs } from './navigation.ts';

const node = (res, index = 0) => ({ res, clazz: 'XCUIElementTypeOther', enabled: true,
  visible: true, children: [], bounds: { x: 50 + index * 60, y: 500, width: 40, height: 40 } });

test('已经位于主标签时只读取一次完整树', async () => {
  let reads = 0;
  await returnToTabs({ nodes: async () => { reads++; return [node('settings-tab')]; } });
  assert.equal(reads, 1);
});

test('关闭分支保持优先级，每次动作刷新状态并执行原有gone检查', async () => {
  const stages = [
    'stepDescription', 'slot-machine-view', 'confirm-pop-up-image-background',
    'select-game-category-text', 'base-create-room-screen',
  ];
  const controls = ['tooltip-finish-button', 'tooltip-next-button', 'close-button', 'cancel-button', 'settings-tab'];
  const actions = [];
  const gone = [];
  const reads = [];
  let stage = 0;
  function current() {
    return [...stages.slice(stage), ...controls].map((res, index) => node(res, index));
  }
  const device = {
    screenSize: { width: 1000, height: 2000 },
    nodes: async () => { reads.push(stage); return current(); },
    info: async selector => {
      const found = current().find(item => item.res === selector.res);
      assert.ok(found, `必须从当前界面查找 ${selector.res}`);
      return found;
    },
    wait: async (selector, options) => {
      const found = current().some(item => item.res === selector.res);
      if (options?.state === 'gone') {
        gone.push(selector.res);
        assert.equal(found, false, '关闭后必须检查当前状态，不能复用动作前树');
      } else assert.equal(found, true);
    },
    waitSnapshot: async selector => {
      assert.ok(current().some(item => item.res === selector.res));
      return current();
    },
    input: {
      tap: async point => {
        const expected = ['tooltip-finish-button', 'close-button', 'cancel-button', 'picker-backdrop'][stage];
        if (stage === 3) {
          assert.equal(point.x, 20);
          assert.equal(point.y, 340);
        } else {
          const target = current().find(item => item.res === expected);
          assert.deepEqual(point, { x: target.bounds.x + 20, y: target.bounds.y + 20 });
        }
        actions.push(expected);
        stage++;
      },
      press: async key => {
        assert.equal(stage, 4);
        assert.equal(key, 'Back');
        actions.push('Back');
        stage++;
      },
    },
  };
  await returnToTabs(device);
  assert.deepEqual(actions, ['tooltip-finish-button', 'close-button', 'cancel-button', 'picker-backdrop', 'Back']);
  assert.deepEqual(gone, stages.slice(1));
  assert.deepEqual([...new Set(reads)], [0, 1, 2, 3, 4, 5]);
});

test('读树驱动异常原样传播，不当作没有弹窗或已返回', async () => {
  const failure = new Error('XCUITest connection lost');
  let reads = 0;
  await assert.rejects(returnToTabs({ nodes: async () => { reads++; throw failure; } }), error => error === failure);
  assert.equal(reads, 1);
});
