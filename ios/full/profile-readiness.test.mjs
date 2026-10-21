import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { profileReadiness, waitForProfileReadiness } from './profile-readiness.ts';
import { captureNativeTransition } from './animation-transition.ts';

const actual = JSON.parse(readFileSync(new URL('./fixtures/profile-readiness/visible-statistics.json', import.meta.url)));
test('异步统计尚未挂载或仍为0时只重读，准确真实100出现后才就绪', async () => {
  const wrong = actual.nodes.map(node => node.res === 'PlayerStatisticComponent_Item_0'
    ? { ...node, text: 'Total Hands, 0' } : node);
  let reads = 0;
  await waitForProfileReadiness({ screenSize: actual.screen,
    nodes: async () => [[], wrong, actual.nodes][Math.min(reads++, 2)] }, '10000');
  assert.equal(reads, 3, '不能把空统计或错误0当作就绪');
});
test('原失败记录的完整可见树确认百场统计100与真实钱包', () => {
  assert.deepEqual(profileReadiness(actual.nodes, actual.screen), ['Total Hands, 100', '10000']);
  for (const res of ['PlayerStatisticComponent_List', 'PlayerStatisticComponent_Item_0', 'player-profile-balance']) {
    const target = actual.nodes.find(node => node.res === res);
    assert.throws(() => profileReadiness(actual.nodes.filter(node => node !== target), actual.screen), /必须唯一/);
    assert.throws(() => profileReadiness([...actual.nodes, target], actual.screen), /必须唯一/);
    for (const bad of [{ ...target, visible: false }, { ...target, bounds: { ...target.bounds, width: 0 } }]) {
      assert.throws(() => profileReadiness(actual.nodes.map(node => node === target ? bad : node), actual.screen));
    }
  }
  const wrong = actual.nodes.map(node => node.res === 'PlayerStatisticComponent_Item_0'
    ? { ...node, text: 'Total Hands, 0' } : node);
  assert.notDeepEqual(profileReadiness(wrong, actual.screen), ['Total Hands, 100', '10000']);
  const outside = actual.nodes.map(node => node.res === 'PlayerStatisticComponent_Item_0'
    ? { ...node, bounds: { ...node.bounds, y: 0 } } : node);
  assert.throws(() => profileReadiness(outside, actual.screen), /首行必须位于当前列表/);
});

const screen = { width: 120, height: 180 };
const node = (res, x, y, width, height, text) => ({ res, text, visible: true,
  clazz: 'XCUIElementTypeOther', bounds: { x, y, width, height }, children: [] });
const panelNodes = [node(undefined, 10, 20, 100, 140),
  node('avatar_image', 20, 26, 18, 18),
  node('player-profile-popup-close', 100, 25, 5, 5),
  node('player-profile-nickname', 20, 25, 40, 8, 'Player'),
  node('player-profile-level', 65, 25, 20, 8, 'Lv 1'),
  node('player-profile-id', 20, 36, 30, 3, 'ID: abcdef12'),
  node('player-profile-balance', 20, 43, 20, 7, '10000'),
  node('PlayerStatisticComponent_List', 18, 60, 84, 90),
  node('PlayerStatisticComponent_Item_0', 18, 60, 40, 14, 'Total Hands, 100')];
function basePicture(panel = false) {
  const png = new PNG(screen);
  for (let y = 0; y < screen.height; y++) for (let x = 0; x < screen.width; x++) {
    const inside = panel && x >= 10 && x < 110 && y >= 20 && y < 160;
    let rgb = inside ? (y < 55 ? [27,30,45] : [50,55,76]) : [20,100+(y%20),60];
    if (panel && x >= 20 && x < 38 && y >= 26 && y < 44)
      rgb = (Math.floor((x-20)/3)+Math.floor((y-26)/3))%2 ? [230,230,230] : [20,20,20];
    if (panel && x >= 100 && x < 105 && y >= 25 && y < 30)
      rgb = ((x - 100) === (y - 25) || (x - 100) + (y - 25) === 4) ? [230,230,230] : [20,20,20];
    png.data.set([...rgb,255],(y*screen.width+x)*4);
  }
  return PNG.sync.write(png);
}
const pictures = new Map([[0,basePicture()],[1,basePicture(true)]]);
const scaledPanel = await sharp(pictures.get(1)).extract({left:10,top:20,width:100,height:140})
  .resize(65,91).png().toBuffer();
const dimmed = await sharp(pictures.get(0)).linear(.9, 0).png().toBuffer();
pictures.set(.65, await sharp(dimmed).composite([{input:scaledPanel,left:28,top:45}]).png().toBuffer());
const picture = (scale = 0) => pictures.get(scale);

for (const profile of ['own-profile', 'opponent-profile-1', 'opponent-profile-2']) {
  test(`${profile} 录后严格语义，不打断录制且继续拒绝只有首尾的硬切`, async () => {
    const oldMode = process.env.IOS_VISUAL_MODE;
    process.env.IOS_VISUAL_MODE = 'smoke';
    try {
      const before = picture(), middle = picture(.65), after = picture(1);
      const run = async frames => {
        let recording = false, ready = false, taps = 0, nodes = 0, screenshots = 0;
        const attachments = new Map();
        const device = { screenSize: screen, nodes: async () => {
          assert.equal(recording, false, '录制时不能读取资料统计树');
          return nodes++ ? panelNodes : [];
        }, nativeScreenshot: async () => screenshots++ ? after : before };
        await captureNativeTransition(device, `texas-holdem-${profile}-enter`,
          { attach: async (name, value) => attachments.set(name, value) },
          { x: 10, y: 20, width: 100, height: 140 }, () => { taps++; }, [], [], 0, 'videoFrames', undefined,
          async () => {
            assert.equal(recording, false);
            assert.equal(screenshots, 1, '严格语义先于独立终点截图');
            assert.deepEqual(profileReadiness(await device.nodes(), screen), ['Total Hands, 100', '10000']);
            ready = true;
          }, [], [], [], [], [], async (_device, _name, _region, trigger, _info, duration) => {
            recording = true;
            await trigger();
            assert.equal(duration, 3500);
            assert.equal(ready, false);
            recording = false;
            return frames;
          });
        assert.equal(taps, 1);
        assert.equal(screenshots, 2);
        assert.equal(nodes, 3, '准备、录后业务和独立终点分别真实查询');
        const timing = JSON.parse(attachments.get(`texas-holdem-${profile}-enter-endpoint-timing`).body);
        assert.deepEqual(timing.map(value => value.phase),
          ['recorder-returned', 'ready-start', 'ready-complete', 'nodes-start', 'nodes-complete', 'screenshot-complete']);
      };
      await run([before, middle, after]);
      await assert.rejects(run([before, before, after]), /真实动画帧|真实缩放中间姿态/);
    } finally {
      if (oldMode === undefined) delete process.env.IOS_VISUAL_MODE;
      else process.env.IOS_VISUAL_MODE = oldMode;
    }
  });
}

test('资料录后语义失败阻止终点；非指定profile与退场保持原查询时机', async () => {
  for (const name of ['texas-holdem-own-profile-enter', 'texas-holdem-opponent-profile-1-enter',
    'texas-holdem-opponent-profile-2-enter', 'texas-holdem-own-profile-exit',
    'texas-holdem-opponent-profile-3-enter', 'zhajinhua-own-profile-enter']) {
    const deferred = /^texas-holdem-(?:own-profile|opponent-profile-[12])-enter$/.test(name);
    let recording = false, screenshots = 0;
    const failure = new Error('wrong real statistics');
    await assert.rejects(captureNativeTransition({ screenSize: screen, nodes: async () => [],
      nativeScreenshot: async () => { screenshots++; return picture(); } }, name,
    { attach: async () => {} }, { x: 0, y: 0, ...screen }, () => {}, [], [], 0, 'videoFrames', undefined,
    async () => { assert.equal(recording, !deferred); throw failure; }, [], [], [], [], [],
    async (_device, _name, _region, trigger) => {
      recording = true;
      try { await trigger(); return [picture(), picture(.65), picture(1)]; }
      finally { recording = false; }
    }), error => error === failure);
    assert.equal(screenshots, 1);
  }
});
