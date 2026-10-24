// 用真实 CI 原片及明确负例验证资料卡缩放，拒绝硬切、数据加载和关闭图形缺失。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { profileZoomLayout, profileZoomEvidence } from './profile-zoom.ts';
import { captureNativeTransition, nativeTargetMotionEvidence } from './animation-transition.ts';
const root = new URL('./fixtures/profile-zoom/', import.meta.url);
const source = JSON.parse(readFileSync(new URL('provenance.json', root)));
const bytes = Object.fromEntries(
  Object.entries(source.files).map(([name, item]) => {
    const buffer = readFileSync(new URL(name + '.png', root));
    assert.equal(createHash('sha256').update(buffer).digest('hex'), item.sha256);
    return [name, buffer];
  })
);
const layout = profileZoomLayout(source.nodes, source.screen, source.region);
test('真实亚像素缩放使用线性模板，原有四边和像素容差不变且拒绝图形缺失', async () => {
  const directory = new URL('./fixtures/profile-zoom-subpixel/', import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', directory)));
  const images = Object.fromEntries(Object.entries(provenance.files).map(([name, item]) => {
    const buffer = readFileSync(new URL(`${name}.png`, directory));
    assert.equal(createHash('sha256').update(buffer).digest('hex'), item.sha256);
    return [name, buffer];
  }));
  const result = await profileZoomEvidence(images.before, images.after,
    [images.before, images.middle, images.after], [0, 1, 2], provenance.layout);
  assert.deepEqual(result.candidates, [1]);
  const middle = result.measurements[1];
  assert.ok(middle.scale > 0.68 && middle.scale < 0.71);
  assert.ok(middle.edges.every(ratio => ratio >= 0.8));
  assert.ok(middle.closeDistance <= 12);
  assert.ok(Math.abs(middle.closeOffset.x) <= 1 && Math.abs(middle.closeOffset.y) <= 1);
  const erased = await sharp(images.middle).composite([{
    input: await sharp({ create: { width: 50, height: 50, channels: 4,
      background: '#1a1d2b' } }).png().toBuffer(), left: 820, top: 204,
  }]).png().toBuffer();
  assert.deepEqual((await profileZoomEvidence(images.before, images.after,
    [erased], [0], provenance.layout)).candidates, []);
  assert.equal(createHash('sha256').update(images.middle).digest('hex'), provenance.files.middle.sha256);
});
test('真实原生缩放保留四边及关闭图形，单像素取整对齐不接受端点硬切', async () => {
  const directory = new URL('./fixtures/profile-zoom-native/', import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', directory)));
  const images = Object.fromEntries(Object.entries(provenance.files).map(([name, item]) => {
    const buffer = readFileSync(new URL(`${name}.png`, directory));
    assert.equal(createHash('sha256').update(buffer).digest('hex'), item.sha256);
    return [name, buffer];
  }));
  const result = await profileZoomEvidence(images.before, images.after,
    [images.before, images.middle, images.after], [0, 1, 2], provenance.layout);
  assert.deepEqual(result.candidates, [1]);
  const middle = result.measurements[1];
  assert.ok(middle.scale > 0.85 && middle.scale < 0.9);
  assert.ok(middle.edges.every(ratio => ratio >= 0.8));
  assert.ok(middle.closeDistance <= 12);
  assert.ok(Math.abs(middle.closeOffset.x) <= 1 && Math.abs(middle.closeOffset.y) <= 1);
});
async function syntheticZoom(
  scale,
  {
    dx = 0,
    dy = 0,
    verticalScale = scale,
    eraseAvatar = false,
    eraseClose = false,
    backgroundScale = 0.9,
  } = {}
) {
  const p = layout.panel;
  let image = sharp(bytes.after).extract({
    left: p.x,
    top: p.y,
    width: p.width,
    height: p.height,
  });
  if (eraseAvatar || eraseClose) {
    const avatar = source.nodes.find((node) => node.res === 'avatar_image').bounds;
    const a = eraseClose
      ? layout.close
      : { ...avatar, x: avatar.x - source.region.x, y: avatar.y - source.region.y };
    image = image.composite([
      {
        input: await sharp({
          create: {
            width: a.width,
            height: a.height,
            channels: 4,
            background: '#1a1d2b',
          },
        })
          .png()
          .toBuffer(),
        left: a.x - p.x,
        top: a.y - p.y,
      },
    ]);
  }
  const original = await image.png().toBuffer();
  const width = Math.round(p.width * scale),
    height = Math.round(p.height * verticalScale);
  const scaled = await sharp(original).resize(width, height).png().toBuffer();
  const dimmed = await sharp(bytes.before).linear(backgroundScale, 0).png().toBuffer();
  return sharp(dimmed)
    .composite([
      {
        input: scaled,
        left: Math.round(p.x + (p.width - width) / 2) + dx,
        top: Math.round(p.y + (p.height - height) / 2) + dy,
      },
    ])
    .png()
    .toBuffer();
}
test('真实Connecting造成旧局部运动误判，新完整四边/关闭图形门禁拒绝；所有原图不变', async () => {
  const original = Buffer.from(bytes.connecting);
  const timeline = [bytes.before, bytes.connecting, bytes.after];
  assert.deepEqual(
    (await nativeTargetMotionEvidence(bytes.before, bytes.after, timeline)).candidates.map(
      (x) => x.index
    ),
    [1]
  );
  const result = await profileZoomEvidence(bytes.before, bytes.after, timeline, [1], layout);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(bytes.connecting, original);
});
test('真实own原片首次已是全尺寸，空统计填充和端点硬切都必须拒绝', async () => {
  const frames = [bytes.before, bytes.empty, bytes.after];
  assert.deepEqual(
    (await profileZoomEvidence(bytes.before, bytes.after, frames, [1, 2], layout)).candidates,
    []
  );
});
test('合成缩放仅验证算法：固定10%背景遮罩下四边与关闭图形同尺度才通过', async () => {
  for (const scale of [0.45, 0.65, 0.85, 0.4537, 0.6584, 0.8572]) {
    const middle = await syntheticZoom(scale);
    const result = await profileZoomEvidence(
      bytes.before,
      bytes.after,
      [bytes.before, middle, bytes.after],
      [1],
      layout
    );
    assert.deepEqual(result.candidates, [1], String(scale));
    assert.ok(Math.abs(result.measurements[0].scale - scale) <= 0.01);
  }
  for (const options of [
    { dx: 40 },
    { dy: 40 },
    { verticalScale: 0.85 },
    { eraseClose: true },
    { backgroundScale: 0.5 },
  ]) {
    const middle = await syntheticZoom(0.65, options);
    assert.deepEqual(
      (
        await profileZoomEvidence(
          bytes.before,
          bytes.after,
          [bytes.before, middle, bytes.after],
          [1],
          layout
        )
      ).candidates,
      [],
      JSON.stringify(options)
    );
  }
});
test('头像异步加载与终点不同，静态关闭图形及四边真实缩放仍通过', async () => {
  const middle = await syntheticZoom(0.65, { eraseAvatar: true });
  assert.deepEqual(
    (await profileZoomEvidence(bytes.before, bytes.after, [middle], [0], layout)).candidates,
    [0]
  );
});
test('缺失/隐藏/重复关闭图形、非原生完整裁图和错误几何均不能进入缩放检查', () => {
  const avatar = source.nodes.find((n) => n.res === 'player-profile-popup-close');
  for (const nodes of [
    source.nodes.filter((n) => n !== avatar),
    [...source.nodes, avatar],
    source.nodes.map((n) => (n === avatar ? { ...n, visible: false } : n)),
    source.nodes.map((n) => (n === avatar ? { ...n, bounds: { ...n.bounds, width: 1 } } : n)),
  ])
    assert.throws(() => profileZoomLayout(nodes, source.screen, source.region));
  assert.throws(
    () =>
      profileZoomLayout(source.nodes, source.screen, {
        ...source.region,
        width: 100,
      }),
    /完整原生/
  );
});

test('真实Connecting/空统计负例经过完整capture也拒绝，合成zoom保持业务端点检查', async () => {
  const full = async (buffer) =>
    sharp({ create: { ...source.screen, channels: 4, background: '#206450' } })
      .composite([{ input: buffer, left: source.region.x, top: source.region.y }])
      .png()
      .toBuffer();
  const before = await full(bytes.before),
    after = await full(bytes.after);
  const previous = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  const run = async (middle) => {
    let queries = 0,
      screenshots = 0,
      taps = 0,
      ready = 0;
    const attachments = [];
    await captureNativeTransition(
      {
        screenSize: source.screen,
        nodes: async () => (queries++ ? source.nodes : []),
        nativeScreenshot: async () => (screenshots++ ? after : before),
      },
      'texas-holdem-opponent-profile-1-enter',
      { attach: async (name, value) => attachments.push({ name, ...value }) },
      source.region,
      () => {
        taps++;
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
      async (_device, _name, _region, trigger) => {
        await trigger();
        return [before, await full(middle), after];
      }
    );
    assert.equal(taps, 1);
    assert.equal(ready, 1);
    assert.equal(screenshots, 2);
    assert.equal(queries, 2);
    assert.equal(
      JSON.parse(attachments.find((a) => a.name.endsWith('-profile-zoom')).body).candidates.length,
      1
    );
  };
  try {
    await assert.rejects(run(bytes.connecting), /资料卡四边/);
    await assert.rejects(run(bytes.empty), /资料卡四边/);
    await run(await syntheticZoom(0.65));
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previous;
  }
});
