import test from 'node:test';
import assert from 'node:assert/strict';
import { scrollToEnd } from './scroll-end.ts';

test('首次原生查询完成后仍会复查页脚，并在连续两次滑动后确认列表末尾', async () => {
  let swipes = 0;
  let footerReads = 0;
  const device = {
    info: async selector => {
      if (selector.res === 'hall-content-list') {
        return { bounds: { x: 0, y: 0, width: 100, height: 500 } };
      }
      footerReads++;
      return { bounds: { x: 10, y: 400, width: 80, height: 50 } };
    },
    input: { swipe: async () => { swipes++; } },
  };

  await scrollToEnd(device, { res: 'hall-content-list' }, { res: 'hall-sign-in-button' });

  assert.equal(swipes, 3, '必须在两次继续滑动后才确认到达末尾');
  assert.equal(footerReads, 6, '每次滑动后必须至少读取两次页脚位置');
});
