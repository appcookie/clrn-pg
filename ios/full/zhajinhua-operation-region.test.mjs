import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { zhajinhuaOperationMarkers, zhajinhuaOperationRegion, zhajinhuaOperationClockMasks,
  zhajinhuaOperationControls, zhajinhuaChallengeCancel, readyZhajinhuaChallengeCancel } from './zhajinhua-operation-region.ts';
import { captureNativeTransition, nativeTargetMotionEvidence } from './animation-transition.ts';
const node = (res, bounds) => ({ res, bounds, visible: true, clazz: 'XCUIElementTypeOther' });
const actualBounds = [
  [206, 1626, 136, 162], [416, 1626, 136, 162], [626, 1626, 136, 162], [836, 1626, 136, 162],
  [491, 1815, 199, 204], [173, 1965, 199, 204], [806, 1965, 199, 204], [962, 2172, 216, 219], [62, 2262, 226, 99],
];
const controls = zhajinhuaOperationMarkers.map((res, index) => {
  const [x, y, width, height] = actualBounds[index];
  return node(res, { x, y, width, height });
});
test('操作入场范围包含全部9个原生按钮，已经显示的起点和缺失按钮必须失败', () => {
  const screen = { width: 1178, height: 2556 };
  assert.deepEqual(zhajinhuaOperationRegion([], controls, screen), { x: 58, y: 1622, width: 1120, height: 773 });
  assert.throws(() => zhajinhuaOperationRegion(controls, controls, screen), /已显示/);
  assert.throws(() => zhajinhuaOperationRegion([], controls.slice(0, -1), screen), /delay-operation/);
});

test('原生倒计时端点遮罩不能覆盖操作按钮', () => {
  const timer = node('zhajinhua-active-countdown', { x: 405, y: 2110, width: 150, height: 150 });
  const player = { ...node('zhajinhua-player-container-self-operating', timer.bounds), children: [timer] };
  assert.deepEqual(zhajinhuaOperationClockMasks([player, ...controls])[0], {
    ...timer.bounds, reason: '仅端点比较排除本人独立倒计时；完整原生录像与按钮中途帧保留',
  });
  assert.throws(() => zhajinhuaOperationClockMasks([player,
    node('zhajinhua-operation-button-fold', timer.bounds)]), /不得覆盖/);
});

test('隐藏操作区、4个挑战目标与取消区域复用同一次完整原生观测，驱动错误直接传播', async () => {
  const targets = Array.from({ length: 4 }, (_, index) => node('challenge_player_selector',
    { x: 20 + index * 30, y: 100, width: 20, height: 20 }));
  const cancel = { ...node('zhajinhua-cancel-challenge-choosing', { x: 0, y: 0, width: 1178, height: 2556 }), enabled: true };
  const prepared = [...targets, cancel];
  let reads = 0;
  const observation = await readyZhajinhuaChallengeCancel(async () => { reads++; return prepared; });
  assert.equal(observation.cancel, cancel);
  assert.equal(observation.nodes, prepared);
  assert.ok(observation.completedAt <= Date.now());
  assert.equal(reads, 1);
  assert.throws(() => zhajinhuaChallengeCancel([...prepared, controls[0]]), /必须消失/);
  assert.throws(() => zhajinhuaChallengeCancel(prepared.slice(1)), /4个真实/);
  assert.throws(() => zhajinhuaChallengeCancel([...targets, { ...cancel, enabled: false }]), /可点击/);
  reads = 0;
  assert.equal((await readyZhajinhuaChallengeCancel(async () => ++reads === 1 ? targets : prepared, 1000, 0)).cancel, cancel);
  assert.equal(reads, 2);
  await assert.rejects(readyZhajinhuaChallengeCancel(async () => { throw new Error('native driver disconnected'); }), /native driver disconnected/);
});

test('九个操作控件必须分别采到真实局部变化，AX容器disabled不豁免运动和终点证据', async () => {
  const size = { width: 360, height: 400 };
  const positions = [[50, 50, 35, 30], [115, 50, 35, 30], [180, 50, 35, 30], [245, 50, 35, 30],
    [150, 140, 50, 50], [50, 220, 50, 50], [250, 220, 50, 50], [320, 300, 35, 35], [20, 300, 35, 30]];
  const nodes = positions.map(([x, y, width, height], index) => node(zhajinhuaOperationMarkers[index], { x, y, width, height }));
  const picture = (phase, hardCut = -1) => {
    const png = new PNG(size);
    for (let offset = 0; offset < png.data.length; offset += 4) png.data.set([20, 90, 70, 255], offset);
    if (!phase) return PNG.sync.write(png);
    for (const [index, { bounds }] of nodes.entries()) {
      const factor = phase === 'middle' && hardCut !== index ? .6 : 1;
      const width = Math.round(bounds.width * factor), height = Math.round(bounds.height * factor);
      const left = bounds.x + Math.floor((bounds.width - width) / 2), top = bounds.y + Math.floor((bounds.height - height) / 2);
      for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
        const icon = Math.abs(x - left - width / 2) < 3;
        png.data.set(icon ? [240, 240, 240, 255] : [230, 100 + index * 10, 15, 255], (y * size.width + x) * 4);
      }
    }
    return PNG.sync.write(png);
  };
  const before = picture(), after = picture('end');
  const previous = process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE = 'smoke';
  const run = async (middle, axGrouped = false, reuse = false, skipEndpoint = false) => {
    let observations = 0, screenshots = 0, triggers = 0, decoded = false;
    const grouped = [{ ...node('zhajinhua-cancel-challenge-choosing', { x:0,y:0,...size }), enabled:false,
      children:nodes.map(item => ({ ...item, visible:false, enabled:true })) }];
    const prepared = reuse ? { completedAt:Date.now(), nodes:[
      {...node('zhajinhua-cancel-challenge-choosing',{x:0,y:0,...size}),enabled:true},
      ...Array.from({length:4},(_,i)=>node('challenge_player_selector',{x:20+i*40,y:10,width:20,height:20})),
    ] } : undefined;
    const device = { screenSize: size, nodes: async () => {
      assert.equal(decoded, false, '解码后回合已结束，必须使用录屏刚停止时的独立观测');
      return observations++ || reuse ? axGrouped ? grouped : nodes : [];
    }, nativeScreenshot: async () => {
      assert.equal(decoded, false, '独立终点截图不能等待长时间解码');
      return screenshots++ ? after : before;
    } };
    await captureNativeTransition(device, 'zhajinhua-operation-buttons', { attach: async () => {} },
      { x: 0, y: 0, ...size }, () => {}, [], [], 0, 'videoFrames', undefined, undefined,
      [], [], [], [], [], async (_device, _name, _region, trigger, _info, _duration, _minimum, onRecorded) => {
        triggers++;
        await trigger();
        assert.equal(screenshots, 1, '录屏中的真实动作不能被终点截图打断');
        if (!skipEndpoint) await onRecorded();
        decoded = true;
        return [before, ...(Array.isArray(middle) ? middle : [middle]), after];
      },
      undefined,prepared);
    return { observations,screenshots,triggers };
  };
  try {
    await run(picture('middle'));
    await run(picture('middle'), true);
    assert.deepEqual(await run(picture('middle'), true, true), { observations:1,screenshots:2,triggers:1 });
    await assert.rejects(run(picture('middle'), true, true, true), /必须在解码前读取独立原生终点/);
    for (let index=0;index<9;index++)
      await assert.rejects(run(picture('middle', index), true), /真实局部中间态/);
    // All main buttons zoom in, but delay hard-cuts to its end state and
    // animates only later. A later loop must not satisfy its entrance gate.
    const lateDelay = PNG.sync.read(after), delayedPose = PNG.sync.read(picture('middle'));
    const delayBounds = nodes[8].bounds;
    PNG.bitblt(delayedPose, lateDelay, delayBounds.x, delayBounds.y, delayBounds.width, delayBounds.height,
      delayBounds.x, delayBounds.y);
    await assert.rejects(run([picture('middle', 8), PNG.sync.write(lateDelay)], true), /真实入场窗口/);
    const dimmer = PNG.sync.read(before);
    for (let offset = 0; offset < dimmer.data.length; offset += 4)
      for (let channel = 0; channel < 3; channel++) dimmer.data[offset + channel] = Math.round(dimmer.data[offset + channel] * .8);
    await assert.rejects(run(PNG.sync.write(dimmer), true), /真实局部中间态/);
  } finally {
    if (previous === undefined) delete process.env.IOS_VISUAL_MODE;
    else process.env.IOS_VISUAL_MODE = previous;
  }
});

const fixture = new URL('./fixtures/zhajinhua-cancel-motion/', import.meta.url);
test('真实Cancel前后AX树仅在唯一可见全屏disabled父层内解析9个目标，保留visible=false', () => {
  const { before, after }=JSON.parse(readFileSync(new URL('native-state.json',fixture)));
  const screen={width:1178,height:2556};
  assert.deepEqual(zhajinhuaOperationRegion([before],[after],screen),{x:58,y:1622,width:1120,height:773});
  assert.equal(zhajinhuaOperationControls([after],screen).length,9);
  assert.ok(zhajinhuaOperationControls([after],screen).every(node=>node.visible===false));
  assert.throws(()=>zhajinhuaOperationControls([after]),/原生控件/);
  for(const patch of [{enabled:true},{visible:false},{res:'unrelated-container'},
    {bounds:{...after.bounds,width:1177}},{bounds:{...after.bounds,height:2557}}])
    assert.throws(()=>zhajinhuaOperationRegion([before],[{...after,...patch}],screen),/原生控件/);
  for(const children of [after.children.slice(1),[...after.children,after.children[0]],
    after.children.map((n,i)=>i? n:{...n,bounds:{...n.bounds,width:0}}),
    after.children.map((n,i)=>i? n:{...n,enabled:false})])
    assert.throws(()=>zhajinhuaOperationRegion([before],[{...after,children}],screen),/原生控件/);
  assert.throws(()=>zhajinhuaOperationRegion([{...before,children:[...before.children,after.children[0]]}],[after],screen),/起点必须全部消失/);
  assert.throws(()=>zhajinhuaOperationRegion([before],[{...after,children:[...after.children,before.children[0]]}],screen),/不得残留/);
});
test('实际原片frame121九控件均有独立结构中间态；静态出现的目标不得凭AX状态通过', async () => {
  const provenance=JSON.parse(readFileSync(new URL('provenance.json',fixture)));
  for(const control of provenance.controls){
    const frames=Object.fromEntries(Object.entries(control.images).map(([key,image])=>{
      const bytes=readFileSync(new URL(image.file,fixture));
      assert.equal(createHash('sha256').update(bytes).digest('hex'),image.sha256);
      return[key,bytes];
    }));
    const evidence=await nativeTargetMotionEvidence(frames.start,frames.end,[frames.middle]);
    assert.ok(evidence.total>3,control.marker);
    assert.equal(evidence.candidates.length,1,control.marker);
    const hardCut=await nativeTargetMotionEvidence(frames.start,frames.end,[frames.start,frames.end]);
    assert.equal(hardCut.candidates.length,0,control.marker);
  }
});

test('真实9控件录像中间帧保留，截图色偏导致的静态尾帧和硬切必须拒绝', async () => {
  const { nativeRecordedTargetMotionEvidence } = await import('./animation-transition.ts');
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', fixture)));
  for (const control of provenance.controls) {
    const frames = Object.fromEntries(Object.entries(control.images).map(([key, image]) =>
      [key, readFileSync(new URL(image.file, fixture))]));
    // Synthetic negative only: a screenshot color shift must not turn an
    // unchanged raw-video endpoint into evidence of structural animation.
    const shifted = PNG.sync.read(frames.end);
    for (let offset = 0; offset < shifted.data.length; offset += 4)
      for (let channel = 0; channel < 3; channel++)
        shifted.data[offset + channel] = Math.min(255, shifted.data[offset + channel] + 35);
    const screenshotEnd = PNG.sync.write(shifted);
    const old = await nativeTargetMotionEvidence(frames.start, screenshotEnd, [frames.end]);
    assert.equal(old.candidates.length, 1, `${control.marker}: negative exercises the old color-shift gap`);
    const hardCut = await nativeRecordedTargetMotionEvidence(frames.start, screenshotEnd,
      [frames.start, frames.end, frames.end]);
    assert.equal(hardCut.candidates.length, 0, control.marker);
    const real = await nativeRecordedTargetMotionEvidence(frames.start, frames.end,
      [frames.start, frames.middle, frames.end]);
    assert.deepEqual(real.candidates.map(item => item.index), [1], control.marker);
  }
});

test('9区域一次解码与逐区域裁图的原始像素完全一致', async () => {
  const { cropNativeFrame, cropNativeRegions } = await import('./motion-regions.ts');
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', fixture)));
  for (const phase of ['start', 'middle', 'end']) {
    const screen = new PNG({ width: 1178, height: 2556 });
    for (const control of provenance.controls) {
      const picture = PNG.sync.read(readFileSync(new URL(control.images[phase].file, fixture)));
      PNG.bitblt(picture, screen, 0, 0, picture.width, picture.height, control.bounds.x, control.bounds.y);
    }
    const bytes = PNG.sync.write(screen), bounds = provenance.controls.map(item => item.bounds);
    const batched = await cropNativeRegions(bytes, bounds);
    for (const [index, region] of bounds.entries())
      assert.deepEqual(batched[index], await cropNativeFrame(bytes, region), `${phase}/${index}`);
  }
});
