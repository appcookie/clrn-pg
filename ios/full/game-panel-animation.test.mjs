import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import sharp from 'sharp';
import { captureNativeTransition } from './animation-transition.ts';
import { animateGamePanel } from './game-panel-animation.ts';

const screen = { width: 120, height: 180 };
const button = {
  res: 'player',
  visible: true,
  enabled: true,
  bounds: { x: 10, y: 20, width: 30, height: 40 },
};
const connecting = { ...button, res: 'Connecting...', text: 'Connecting...' };
const timeout = {
  ...button,
  res: 'common-alert-title',
  text: 'Connection Timeout',
};

for (const [name, resource] of [
  ['renew', 'renew-popup-close-button'],
  ['theme', 'game-settings-close-button'],
]) {
  test(`${name}退场录屏预热时重连，恢复并重读关闭按钮后仅点击一次`, async () => {
    const close = { ...button, res: resource };
    const movedClose = { ...close, bounds: { ...close.bounds, x: 50 } };
    let recording = false, reads = 0;
    const taps = [];
    const device = {
      screenSize: screen,
      prepareTransientCapture: async () => { assert.equal(recording, true); },
      inputObservation: async () => {
        assert.equal(recording, true);
        assert.equal(taps.length, 0, '点击后不得以原生查询打断退场动画');
        return ++reads <= 2 ? [close, connecting] : [movedClose];
      },
      nodes: async () => { throw new Error('不应使用录屏前的旧原生树'); },
      input: { tap: async point => { taps.push({ point, reads }); } },
    };
    await animateGamePanel(device, 'texas-holdem', name, close.res, close.bounds,
      { attach: async () => {} }, 'exit', 'motionFrames', [], undefined, [],
      async (_device, _name, _info, _region, trigger) => {
        assert.equal(reads, 0);
        recording = true;
        await trigger();
        recording = false;
      });
    assert.equal(taps.length, 1);
    assert.deepEqual(taps[0].point, { x: 65, y: 40 });
    assert.ok(taps[0].reads >= 6, '必须在重连消失后重新取得稳定的关闭按钮位置');
  });

  test(`${name}退场预热后出现连接超时，不得点击关闭按钮`, async () => {
    const close = { ...button, res: resource };
    let taps = 0;
    const device = {
      screenSize: screen,
      prepareTransientCapture: async () => {},
      inputObservation: async () => [close, timeout],
      nodes: async () => { throw new Error('不应使用录屏前的旧原生树'); },
      input: { tap: async () => { taps++; } },
    };
    await assert.rejects(animateGamePanel(device, 'texas-holdem', name, close.res, close.bounds,
      { attach: async () => {} }, 'exit', 'motionFrames', [], undefined, [],
      async (_device, _name, _info, _region, trigger) => trigger()), /Connection Timeout/);
    assert.equal(taps, 0);
  });
}

for (const name of ['own-profile', 'opponent-profile-1', 'opponent-profile-2']) {
  test(`${name}: 预热才开始重连时恢复后单次点击，tap后不再查询直到录后语义`, async () => {
    let recording = false,
      reads = 0,
      tapped = false,
      semantic = false;
    const taps = [],
      attachments = new Map();
    const device = {
      screenSize: screen,
      nodes: async () => {
        assert.equal(recording, true, '这两份就绪树必须移动到录制预热之后');
        assert.equal(tapped, false, '实际点击后的动画不能被树查询打断');
        reads++;
        return reads === 1 ? [button, connecting] : [button];
      },
      input: {
        tap: async (point) => {
          assert.equal(recording, true);
          taps.push({ point, at: Date.now(), reads });
          tapped = true;
        },
      },
    };
    await animateGamePanel(
      device,
      'texas-holdem',
      name,
      'player',
      button.bounds,
      { attach: async (name, attachment) => attachments.set(name, attachment) },
      'enter',
      'videoFrames',
      [],
      async () => {
        assert.equal(recording, false);
        semantic = true;
      },
      [],
      async (
        _device,
        _name,
        _info,
        _region,
        trigger,
        _masks,
        _regions,
        _settle,
        _method,
        _inspect,
        afterReady
      ) => {
        assert.equal(reads, 0, '不能沿用录制预热之前的旧连接证据');
        recording = true;
        await trigger();
        assert.equal(semantic, false);
        recording = false;
        await afterReady();
      }
    );
    assert.equal(taps.length, 1);
    assert.deepEqual(taps[0].point, { x: 25, y: 40 });
    assert.ok(taps[0].reads >= 6, '恢复必须连续一秒无Connecting，并有后续第二份真实样本');
    const timing = JSON.parse(attachments.get(`texas-holdem-${name}-enter-tap-timing`).body);
    assert.ok(
      Date.parse(timing.tapRequestedUtc) - Date.parse(timing.preparationStartedUtc) >= 1190
    );
    assert.ok(Math.abs(Date.parse(timing.tapRequestedUtc) - taps[0].at) < 20);
    assert.deepEqual(timing.point, taps[0].point);
    assert.equal(semantic, true);
  });
}

test('profile触发前任一样本timeout或驱动错误均0tap，并且不伪造实际点击时间', async () => {
  for (const sample of [0, 1])
    for (const bad of [[button, timeout], new Error('source failed')]) {
      let reads = 0,
        taps = 0,
        timing;
      const device = {
        screenSize: screen,
        nodes: async () => {
          if (reads++ !== sample) return [button];
          if (bad instanceof Error) throw bad;
          return bad;
        },
        input: {
          tap: async () => {
            taps++;
          },
        },
      };
      await assert.rejects(
        animateGamePanel(
          device,
          'texas-holdem',
          'own-profile',
          'player',
          button.bounds,
          {
            attach: async (_name, attachment) => {
              timing = JSON.parse(attachment.body);
            },
          },
          'enter',
          'videoFrames',
          [],
          undefined,
          [],
          async (_d, _n, _i, _r, trigger) => trigger()
        ),
        bad instanceof Error ? /source failed/ : /Connection Timeout/
      );
      assert.equal(reads, sample + 1);
      assert.equal(taps, 0);
      assert.equal(timing.tapRequestedUtc, undefined);
      assert.equal(timing.point, undefined);
    }
});

test('profile退场、其他入口和其他玩法仍保留原采样前准备顺序', async () => {
  for (const [game, name, phase] of [
    ['texas-holdem', 'own-profile', 'exit'],
    ['texas-holdem', 'opponent-profile-3', 'enter'],
    ['zhajinhua', 'own-profile', 'enter'],
    ['texas-holdem', 'personal-leaderboard', 'enter'],
  ]) {
    let capturing = false,
      reads = 0,
      taps = 0;
    const device = {
      screenSize: screen,
      nodes: async () => {
        assert.equal(capturing, false);
        reads++;
        return [button];
      },
      input: {
        tap: async () => {
          assert.equal(capturing, true);
          taps++;
        },
      },
    };
    await animateGamePanel(
      device,
      game,
      name,
      'player',
      button.bounds,
      { attach: async () => {} },
      phase,
      'videoFrames',
      [],
      undefined,
      [],
      async (_d, _n, _i, _r, trigger) => {
        assert.equal(reads, 2);
        capturing = true;
        await trigger();
      }
    );
    assert.equal(taps, 1);
  }
});

test('菜单面板入场在录屏预热后重新确认目标位置并只点击一次', async () => {
  let recording = false, prepared = false, reads = 0;
  const taps = [], attachments = new Map();
  const item = { res: 'drawer-menu-item-settings', visible: true, enabled: true,
    bounds: { x: 40, y: 20, width: 30, height: 40 } };
  const prewarmupBounds = { ...item.bounds, x: 10 };
  const device = {
    screenSize: screen,
    nodes: async () => { throw new Error('菜单入口不应沿用录屏预热前的整树'); },
    prepareTransientCapture: async () => { prepared = true; },
    inputObservation: async () => {
      assert.equal(recording, true, '目标查询必须发生在录屏期间');
      assert.equal(prepared, true, '查询前必须准备原生属性');
      reads++;
      return [item];
    },
    input: { tap: async point => { taps.push(point); } },
  };
  await animateGamePanel(device, 'zhajinhua', 'settings', item.res, prewarmupBounds,
    { attach: async (name, attachment) => attachments.set(name, attachment) },
    'enter', 'videoFrames', [], undefined, [],
    async (_device, _name, _info, _region, trigger) => {
      recording = true;
      await trigger();
      recording = false;
    });
  assert.ok(reads >= 2, '点击前必须取得两份稳定的当前观测');
  assert.deepEqual(taps, [{ x: 55, y: 40 }], '只能点击录屏期间确认的真实中心');
  const timing = JSON.parse(attachments.get('zhajinhua-settings-enter-tap-timing').body);
  assert.deepEqual(timing.point, taps[0]);
});

const node = (res, x, y, width, height, text) => ({
  res,
  text,
  visible: true,
  clazz: 'XCUIElementTypeOther',
  bounds: { x, y, width, height },
  children: [],
});
const panelNodes = [
  node(undefined, 10, 20, 100, 140),
  node('avatar_image', 20, 26, 18, 18),
  node('player-profile-popup-close', 100, 25, 5, 5),
  node('player-profile-nickname', 20, 25, 40, 8, 'Player'),
  node('player-profile-level', 65, 25, 20, 8, 'Lv 1'),
  node('player-profile-id', 20, 36, 30, 3, 'ID: abcdef12'),
  node('player-profile-balance', 20, 43, 20, 7, '10000'),
  node('PlayerStatisticComponent_List', 18, 60, 84, 90),
  node('PlayerStatisticComponent_Item_0', 18, 60, 40, 14, 'Total Hands, 100'),
];
function basePicture(panel = false) {
  const png = new PNG(screen);
  for (let y = 0; y < screen.height; y++)
    for (let x = 0; x < screen.width; x++) {
      const inside = panel && x >= 10 && x < 110 && y >= 20 && y < 160;
      let rgb = inside ? (y < 55 ? [27, 30, 45] : [50, 55, 76]) : [20, 100 + (y % 20), 60];
      if (panel && x >= 20 && x < 38 && y >= 26 && y < 44)
        rgb =
          (Math.floor((x - 20) / 3) + Math.floor((y - 26) / 3)) % 2
            ? [230, 230, 230]
            : [20, 20, 20];
      if (panel && x >= 100 && x < 105 && y >= 25 && y < 30)
        rgb = x - 100 === y - 25 || x - 100 + (y - 25) === 4 ? [230, 230, 230] : [20, 20, 20];
      png.data.set([...rgb, 255], (y * screen.width + x) * 4);
    }
  return PNG.sync.write(png);
}
const pictures = new Map([
  [0, basePicture()],
  [1, basePicture(true)],
]);
const scaledPanel = await sharp(pictures.get(1))
  .extract({ left: 10, top: 20, width: 100, height: 140 })
  .resize(65, 91)
  .png()
  .toBuffer();
const dimmed = await sharp(pictures.get(0)).linear(0.9, 0).png().toBuffer();
pictures.set(
  0.65,
  await sharp(dimmed)
    .composite([{ input: scaledPanel, left: 28, top: 45 }])
    .png()
    .toBuffer()
);
const picture = (scale = 0) => pictures.get(scale);

test('只有连接spinner运动而资料硬切时，不能冒充profile的真实zoom中间帧', async () => {
  const before = picture(),
    after = picture(1);
  const loading = PNG.sync.read(before);
  for (let y = 75; y < 105; y++)
    for (let x = 45; x < 75; x++) {
      const radius = Math.hypot(x - 60, y - 90);
      if (radius > 9 && radius < 13 && x < 65)
        loading.data.set([245, 245, 245, 255], (y * screen.width + x) * 4);
    }
  const previous = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  try {
    let queries = 0,
      screenshots = 0;
    await assert.rejects(
      captureNativeTransition(
        {
          screenSize: screen,
          nodes: async () => (queries++ ? panelNodes : []),
          nativeScreenshot: async () => (screenshots++ ? after : before),
        },
        'texas-holdem-opponent-profile-1-enter',
        { attach: async () => {} },
        { x: 10, y: 20, width: 100, height: 140 },
        () => {},
        [],
        [],
        0,
        'videoFrames',
        undefined,
        undefined,
        [],
        [],
        [],
        [],
        [],
        async () => [before, PNG.sync.write(loading), after]
      ),
      /真实动画帧|真实缩放中间姿态/
    );
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previous;
  }
});
