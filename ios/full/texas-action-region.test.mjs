import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { texasOperationMarkers, texasOperationRegion, texasShortcutMotionBounds,
  texasPlayerActionRegion, texasPlayerActionMotionBounds, texasActionClockMasks } from './texas-action-region.ts';
import { captureNativeTransition, nativeTargetMotionEvidence } from './animation-transition.ts';

const node = (res, [x, y, width, height], children = []) => ({ res, visible: true,
  bounds: { x, y, width, height }, children });
const screen = { width: 1178, height: 2556 };
// Native bounds observed in run 39537101186, river and opponent-turn trees.
const controls = [[206,1626,136,162],[416,1626,136,162],[626,1626,136,162],[836,1626,136,162],
  [491,1815,196,204],[206,1896,196,201],[776,1896,196,201],[947,2034,231,231],[14,2166,226,99]]
  .map((bounds, index) => node(texasOperationMarkers[index], bounds));
const auto = [['Any Call',491,1800],['Check/Fold',206,1896],['Check',776,1896]]
  .map(([name,x,y]) => node(`texas-holdem-auto-button-${name}`, [x,y,196,201]));
test('德州操作范围保留全部9个新按钮及起点自动按钮，缺失/未切换必须失败', () => {
  assert.deepEqual(texasOperationRegion(auto, controls, screen), { x:10,y:1622,width:1168,height:647 });
  assert.deepEqual(texasShortcutMotionBounds(auto, controls, screen), { x:206,y:1626,width:766,height:162 });
  assert.throws(() => texasOperationRegion([...auto, controls[0]], controls, screen), /起点必须消失/);
  assert.throws(() => texasOperationRegion(auto, controls.slice(0,-1), screen), /delay-operation/);
  assert.throws(() => texasOperationRegion(auto, [...controls, auto[0]], screen), /不得残留/);
  assert.throws(() => texasShortcutMotionBounds([node('texas-holdem-auto-button-Any Call',[220,1650,100,100])], controls, screen), /不得覆盖/);
});
const playerId = 'texas-holdem-player-container-00000000-0000-4000-8000-000000000002';
const timer = node('texas-holdem-active-countdown', [50,951,160,160]);
const before = [node(`${playerId}-operating`, [50,951,160,288], [timer])];
const label = node('texas-holdem-player-action-call', [146,1029,127,78],
  [node('image', [146,1029,127,78]), node('text', [149,1041,121,39])]);
const after = [node(playerId, [50,951,160,288], [label])];
test('玩家动作按当前玩家子树截取完整气泡，不能拿同名其他玩家或头像倒计时当目标', () => {
  const decoy = node('texas-holdem-player-container-other', [200,300,160,288],
    [node('texas-holdem-player-action-call', [236,351,130,78])]);
  assert.deepEqual(texasPlayerActionRegion('texas-player-action-call', before, [...after, decoy], screen),
    { x:142,y:1025,width:135,height:86 });
  assert.deepEqual(texasPlayerActionMotionBounds('texas-player-action-call', before, after),
    { x:210,y:1029,width:63,height:78 });
  assert.throws(() => texasPlayerActionRegion('texas-player-action-call', before, [decoy], screen), /同一玩家/);
  assert.throws(() => texasPlayerActionRegion('texas-player-action-call',
    [node(`${playerId}-operating`,[50,951,160,288],[label])], after, screen), /起点必须消失/);
});
test('仅端点使用原生倒计时范围，禁止遮住可见气泡或按钮', () => {
  assert.deepEqual(texasActionClockMasks(before).map(({ reason, ...bounds }) => bounds), [timer.bounds]);
  assert.deepEqual(texasActionClockMasks(after), []);
  assert.throws(() => texasActionClockMasks([...before, label]), /不得覆盖/);
  assert.throws(() => texasActionClockMasks([...before, node(texasOperationMarkers[0],[50,960,100,100])]), /不得覆盖/);
});
test('原始录像真实气泡/快捷筹码缩放通过，只有旧倒计时或自动按钮消失必须失败', async () => {
  const root = new URL('./fixtures/texas-action-motion/', import.meta.url);
  const provenance = JSON.parse(readFileSync(new URL('provenance.json', root)));
  for (const item of provenance.cases) {
    const buffers = Object.fromEntries(Object.entries(item.frames).map(([key, frame]) => {
      const bytes = readFileSync(new URL(frame.file, root));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), frame.sha256);
      return [key, bytes];
    }));
    const negative = await nativeTargetMotionEvidence(buffers.start, buffers.end, [buffers['old-control-only']]);
    const positive = await nativeTargetMotionEvidence(buffers.start, buffers.end, [buffers.middle]);
    assert.equal(negative.candidates.length, 0, item.name);
    assert.equal(positive.candidates.length, 1, item.name);
  }
});
test('德州操作集成门禁要求新快捷筹码及每个主按钮真实中途帧，退旧按钮或单个硬切均失败', async () => {
  const image = (phase, hardCut = false) => {
    const png = new PNG(screen);
    for (let i=0;i<png.data.length;i+=4) png.data.set([20,90,70,255],i);
    const drawing = phase === 'start' ? auto : phase === 'removed' ? [] : controls;
    for (const [index,control] of drawing.entries()) {
      const b=control.bounds, factor=phase==='middle' && !(hardCut && index===5) ? .6 : 1;
      const w=Math.round(b.width*factor),h=Math.round(b.height*factor);
      const x0=b.x+Math.floor((b.width-w)/2),y0=b.y+Math.floor((b.height-h)/2);
      for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)
        png.data.set(phase==='start'?[120,140,130,255]:[230,100+index*10,15,255],(y*screen.width+x)*4);
    }
    return PNG.sync.write(png);
  };
  const start=image('start'),end=image('end'),previous=process.env.IOS_VISUAL_MODE;
  process.env.IOS_VISUAL_MODE='smoke';
  const run = middle => {
    let observations=0,screenshots=0;
    const device={screenSize:screen,nodes:async()=>observations++?controls:auto,
      nativeScreenshot:async()=>screenshots++?end:start};
    return captureNativeTransition(device,'texas-operation-buttons',{attach:async()=>{}},
      {x:0,y:0,...screen},()=>{},[],[],0,'videoFrames',undefined,undefined,[],[],[],[],[],
      async(_device,_name,_region,trigger)=>{await trigger();return[start,middle,end];});
  };
  try {
    await run(image('middle'));
    await assert.rejects(run(image('removed')),/目标本身必须有真实中间帧/);
    await assert.rejects(run(image('middle',true)),/fold.*真实局部中间态/);
  } finally { if(previous===undefined)delete process.env.IOS_VISUAL_MODE;else process.env.IOS_VISUAL_MODE=previous; }
});
