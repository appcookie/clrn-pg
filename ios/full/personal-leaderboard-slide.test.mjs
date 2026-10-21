import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { leaderboardSlideLayout, leaderboardSlideEvidence } from './personal-leaderboard-slide.ts';
import { captureNativeTransition } from './animation-transition.ts';
const root = new URL('./fixtures/personal-leaderboard-slide/', import.meta.url);
const source = JSON.parse(readFileSync(new URL('provenance.json', root)));
const images = Object.fromEntries(
  Object.entries(source.files).map(([name, item]) => {
    const bytes = readFileSync(new URL(`${name}.png`, root));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    return [name, bytes];
  })
);
const layout = leaderboardSlideLayout(source.nodes, source.screen, source.region);
async function translated(offset, { stationaryClose = false, eraseClose = false } = {}) {
  const p = layout.panel,
    c = layout.close;
  let panel = images.after;
  if (eraseClose || stationaryClose)
    panel = await sharp(panel)
      .composite([
        {
          input: await sharp({
            create: {
              width: c.width,
              height: c.height,
              channels: 4,
              background: '#041716',
            },
          })
            .png()
            .toBuffer(),
          left: c.x,
          top: c.y,
        },
      ])
      .png()
      .toBuffer();
  const shifted = await sharp(panel)
    .extract({
      left: offset,
      top: 0,
      width: p.width - offset,
      height: p.height,
    })
    .png()
    .toBuffer();
  const background = await sharp(images.before).linear(0.9, 0).png().toBuffer();
  const layers = [{ input: shifted, left: 0, top: 0 }];
  if (stationaryClose)
    layers.push({
      input: await sharp(images.after)
        .extract({ left: c.x, top: c.y, width: c.width, height: c.height })
        .png()
        .toBuffer(),
      left: c.x,
      top: c.y,
    });
  return sharp(background).composite(layers).png().toBuffer();
}

test('真实9帧采样首现已是全尺寸，昵称与数据加载不是侧栏滑入', async () => {
  const original = Buffer.from(images.loading);
  const result = await leaderboardSlideEvidence(
    images.before,
    images.after,
    [images.before, images.loading, images.after],
    [1, 2],
    layout
  );
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(images.loading, original);
});

test('合成平移仅验证算法：完整边界和关闭图形须具有同一位移', async () => {
  for (const offset of [60, 150, 270]) {
    const middle = await translated(offset);
    const result = await leaderboardSlideEvidence(
      images.before,
      images.after,
      [middle],
      [0],
      layout
    );
    assert.deepEqual(result.candidates, [0], String(offset));
    assert.ok(Math.abs(result.measurements[0].offset - offset) <= 12);
  }
  for (const options of [{ stationaryClose: true }, { eraseClose: true }]) {
    const middle = await translated(150, options);
    assert.deepEqual(
      (await leaderboardSlideEvidence(images.before, images.after, [middle], [0], layout))
        .candidates,
      []
    );
  }
  const dim = await sharp(images.before).linear(0.9, 0).png().toBuffer();
  assert.deepEqual(
    (await leaderboardSlideEvidence(images.before, images.after, [dim], [0], layout)).candidates,
    []
  );
});

test('缺失重复隐藏关闭按钮、错误几何或不完整ROI直接拒绝', () => {
  const close = source.nodes.find((node) => node.res === 'personal-leader-board-close-button');
  for (const nodes of [
    source.nodes.filter((node) => node !== close),
    [...source.nodes, close],
    source.nodes.map((node) => (node === close ? { ...node, visible: false } : node)),
    source.nodes.map((node) =>
      node === close ? { ...node, bounds: { ...node.bounds, height: 0 } } : node
    ),
  ])
    assert.throws(() => leaderboardSlideLayout(nodes, source.screen, source.region));
  assert.throws(() =>
    leaderboardSlideLayout(source.nodes, source.screen, {
      ...source.region,
      width: 900,
    })
  );
});

test('完整capture保留一次触发和业务检查，真实数据加载负例不能变成middle', async () => {
  const full = async (buffer) =>
    sharp({ create: { ...source.screen, channels: 4, background: '#135c3a' } })
      .composite([{ input: buffer, left: 0, top: 0 }])
      .png()
      .toBuffer();
  const before = await full(images.before),
    after = await full(images.after);
  const oldMode = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  const run = async (middle) => {
    let nodes = 0,
      screens = 0,
      trigger = 0,
      ready = 0;
    await captureNativeTransition(
      {
        screenSize: source.screen,
        nodes: async () => (nodes++ ? source.nodes : []),
        nativeScreenshot: async () => (screens++ ? after : before),
      },
      'texas-holdem-personal-leaderboard-enter',
      { attach: async () => {} },
      source.region,
      () => {
        trigger++;
      },
      [],
      [],
      0,
      'videoFrames',
      undefined,
      async () => {
        ready++;
      },
      [],
      [],
      [],
      [],
      [],
      async (_device, _name, _region, action) => {
        await action();
        return [before, await full(middle), after];
      }
    );
    assert.equal(trigger, 1);
    assert.equal(ready, 1);
    assert.equal(nodes, 2);
    assert.equal(screens, 2);
  };
  try {
    await assert.rejects(run(images.loading), /边界和关闭按钮|真实动画帧/);
    await run(await translated(150));
  } finally {
    if (oldMode === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = oldMode;
  }
});
