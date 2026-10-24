import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { texasActionStart, compareTexasActionStart } from './texas-action-start.ts';
import { captureNativeTransition, frameColorDistance } from './animation-transition.ts';

const root = new URL('./fixtures/texas-action-start/', import.meta.url);
const provenance = JSON.parse(readFileSync(new URL('provenance.json', root)));
const frames = Object.fromEntries(Object.entries(provenance.frames).map(([name, source]) => {
  const bytes = readFileSync(new URL(name, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  return [name.replace('.png', ''), bytes];
}));
const node = (res, bounds, children = []) => ({ res, bounds, visible: true, children });
const id = 'texas-holdem-player-container-00000000-0000-4000-8000-000000000002';
const screen = { width: 1178, height: 2556 };
const geometry = (action = 'call') => {
  const timer = node('texas-holdem-active-countdown', { x:50,y:1014,width:160,height:162 });
  const player = { x:50,y:951,width:160,height:288 };
  const label = node(`texas-holdem-player-action-${action}`, { x:146,y:1029,width:127,height:78 });
  return { before:[node(`${id}-operating`,player,[timer])], after:[node(id,player,[label])], timer, label };
};
const plan = (g = geometry(), name = 'texas-player-action-call', region = provenance.region, size = screen) =>
  texasActionStart(name, g.before, g.after, size, region);

test('真实首帧倒计时变化只排除原生timer，保留像素归一化差2.47且原图不变', () => {
  const start = plan(), original = Buffer.from(frames.first);
  assert.ok(Math.abs(frameColorDistance(frames.first,frames.before)-22.59497559575079)<1e-9);
  const compared = compareTexasActionStart(frames.first,frames.before,start);
  assert.ok(Math.abs(compared.distance-2.4716533611014695)<1e-9);
  assert.equal(compared.comparedPixels,67*86);
  assert.equal(compared.excludedPixels,68*86);
  assert.deepEqual(frames.first,original);
  assert.equal(compareTexasActionStart(frames.before,frames.before,start).samePixels,true);
  // An action already drawn at recording start still fails the unchanged 10 gate.
  assert.ok(compareTexasActionStart(frames.end,frames.before,start).distance>10);
});

test('四项白名单及完整timer/屏幕/目标约束，错误或重叠排除必须失败', () => {
  for (const action of ['call','raise','check','fold']) assert.doesNotThrow(() => plan(geometry(action),`texas-player-action-${action}`));
  assert.throws(() => plan(geometry(),'texas-player-action-all_in'),/未知/);
  assert.throws(() => plan(geometry(),undefined,{...provenance.region,width:134}),/完整/);
  assert.throws(() => plan(geometry(),undefined,undefined,{width:200,height:2556}),/屏幕内/);
  const mutate = change => { const g=geometry();change(g);return () => plan(g); };
  assert.throws(mutate(g=>g.timer.res='unrelated-background'),/唯一实际原生倒计时/);
  assert.throws(mutate(g=>g.timer.bounds.x=-1),/当前玩家范围内/);
  assert.throws(mutate(g=>g.timer.bounds.width=1178),/当前玩家范围内/);
  assert.throws(mutate(g=>g.timer.bounds.width=140),/真实头像范围/);
  assert.throws(mutate(g=>g.timer.bounds.height=250),/当前玩家范围内/);
  assert.throws(mutate(g=>g.before[0].children.push(g.label)),/起点必须消失/);
  assert.throws(mutate(g=>g.before[0].children.push(node('texas-holdem-player-action-fold',g.label.bounds))),/已有动作标签/);
  assert.throws(mutate(g=>{g.before[0].bounds={x:50,y:951,width:240,height:350};g.timer.bounds={x:50,y:1014,width:240,height:240};}),/头像之外的动作目标/);
  assert.throws(() => compareTexasActionStart(frames.first,frames.before,{...plan(),region:{...provenance.region,width:1}}),/完整原生范围/);
});

test('错误气泡位置/文字仍被起点对齐和逐像素基准比较拦截', () => {
  const start=plan();
  for(const kind of ['wrong-position','wrong-text']) {
    const image=PNG.sync.read(frames.before);
    for(let y=8;y<70;y++)for(let x=75;x<125;x++) {
      const color=kind==='wrong-position'?[130,210,15,255]:[255,255,255,255];
      image.data.set(color,(y*image.width+x)*4);
    }
    const altered=PNG.sync.write(image),result=compareTexasActionStart(altered,frames.before,start);
    assert.ok(result.distance>10,kind);
    assert.equal(result.samePixels,false,kind);
  }
  // Even one changed foreground pixel is rejected by exact start-baseline matching.
  const image=PNG.sync.read(frames.before);image.data.set([255,255,255,255],(20*image.width+100)*4);
  assert.equal(compareTexasActionStart(PNG.sync.write(image),frames.before,start).samePixels,false);
});

test('真实原片气泡缩放通过完整capture，已有气泡首帧及硬切仍失败', async () => {
  // A plain surrounding canvas keeps this unit test small; all pixels within
  // the full native ROI are the unmodified real screenshot/video crops.
  const full = bytes => {
    const canvas=new PNG(screen),part=PNG.sync.read(bytes),r=provenance.region;
    for(let offset=0;offset<canvas.data.length;offset+=4)canvas.data.set([20,90,70,255],offset);
    PNG.bitblt(part,canvas,0,0,part.width,part.height,r.x,r.y);
    return PNG.sync.write(canvas);
  };
  const source=Object.fromEntries(Object.entries(frames).map(([key,bytes])=>[key,full(bytes)]));
  const previous=process.env.IOS_VISUAL_MODE;process.env.IOS_VISUAL_MODE='smoke';
  const run = async recording => {
    const g=geometry();let observations=0,screenshots=0,triggered=0;
    const attachments=[];
    const device={screenSize:screen,nodes:async()=>observations++?g.after:g.before,
      nativeScreenshot:async()=>screenshots++?source.end:source.before};
    await captureNativeTransition(device,'texas-player-action-call',{attach:async(name,attachment)=>attachments.push({name,...attachment})},
      provenance.region,()=>{triggered++;},[],[],0,'videoFrames',undefined,undefined,[],[],[],[],[],
      async(_device,_name,_region,trigger)=>{await trigger();return recording;});
    assert.equal(triggered,1);
    const alignment=JSON.parse(attachments.find(item=>item.name.endsWith('-start-alignment')).body);
    assert.ok(Math.abs(alignment.distance-2.4716533611014695)<1e-9);
    assert.ok(attachments.some(item=>item.name==='texas-player-action-call-middle'));
  };
  try {
    await run([source.first,source.middle,source.end]);
    await assert.rejects(run([source.end,source.middle,source.end]),/录屏首帧须包含/);
    await assert.rejects(run([source.first,source.first,source.end]),/目标本身必须有真实中间帧/);
  } finally { if(previous===undefined)delete process.env.IOS_VISUAL_MODE;else process.env.IOS_VISUAL_MODE=previous; }
});
