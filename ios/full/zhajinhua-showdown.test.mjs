import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PNG } from 'pngjs';
import { flattenNodes } from './game-controls.ts';
import { zhajinhuaShowdownLayout, compareShowdownStart, showdownHorizontalEvidence } from './zhajinhua-showdown.ts';
import { animationRegion } from './animation-region.ts';
import { cropMotionRegion } from './motion-regions.ts';
import { captureNativeTransition } from './animation-transition.ts';

const root=new URL('./fixtures/zhajinhua-showdown/',import.meta.url);
const source=JSON.parse(readFileSync(new URL('provenance.json',root)));
const nativeBytes=readFileSync(new URL('native-state.json',root));
assert.equal(createHash('sha256').update(nativeBytes).digest('hex'),source.nativeStateSha256);
const state=JSON.parse(nativeBytes),screen={width:1178,height:2556};
const before=flattenNodes(state.before),after=flattenNodes(state.after);
const layout=zhajinhuaShowdownLayout(before,after,screen);
const images=Object.fromEntries(Object.entries(source.frames).map(([key,frame])=>{
  const bytes=readFileSync(new URL(frame.file,root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),frame.sha256);
  return [key,bytes];
}));

test('真实原生范围保留三牌包装与完整Pair，AX sprite标志不被伪写',async()=>{
  assert.deepEqual(layout.region,{x:0,y:1370,width:295,height:254});
  assert.deepEqual(layout.label,{x:50,y:1566,width:160,height:54});
  assert.equal(layout.cards.length,3);
  assert.deepEqual(animationRegion('zhajinhua-showdown-cards',before,after,{screenSize:screen},
    {x:13,y:1392,width:278,height:204}).bounds,layout.region);
  assert.ok(after.filter(node=>node.res==='sprite-image-content').every(node=>node.visible===false));
  const bad=structuredClone(state.after);bad.children=bad.children.filter(node=>node.res!=='Pair');
  assert.throws(()=>zhajinhuaShowdownLayout(before,flattenNodes(bad),screen),/完整牌型标签/);
  assert.throws(()=>zhajinhuaShowdownLayout(before,after,{width:280,height:2556}),/完整位于屏幕/);
  const clipped=cropMotionRegion(images.end,{x:0,y:0,width:295,height:230});
  await assert.rejects(()=>showdownHorizontalEvidence(images.first,clipped,[images.first,clipped],[0],layout),/完整原生范围/);
});

test('真实失败原片字体加载和静态尾段都不能代替第二/三张牌水平展开',async()=>{
  const raw=await showdownHorizontalEvidence(images.first,images.end,[images.first,images['sprite-loading'],images.end],[1,2],layout);
  assert.deepEqual(raw.cards.map(card=>card.candidates.length),[0,0]);
  assert.deepEqual(raw.middleIndices,[]);
  await assert.rejects(()=>showdownHorizontalEvidence(images.end,images.end,[images.end,images.end],[0],layout),/起点不得已含/);
});

// Synthetic unit-only card identities validate the displacement detector;
// they are not native positive evidence and are never baseline candidates.
const drawing=(shifts,hidden=false,identities=[0,1,2])=>{
  const p=new PNG({width:layout.region.width,height:layout.region.height});
  for(let i=0;i<p.data.length;i+=4)p.data.set([20,90,70,255],i);
  if(!hidden)for(const [index,b] of layout.cards.entries()){
    for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){
      const identity=identities[index],stripe=((x*7+y*11+identity*17)%37)<16;
      const color=identity===0?[stripe?230:50,30,40,255]:identity===1?[30,stripe?240:40,50,255]:[35,45,stripe?230:40,255];
      const targetX=b.x-layout.region.x+x-(shifts[index]||0),targetY=b.y-layout.region.y+y;
      p.data.set(color,(targetY*p.width+targetX)*4);
    }
  }
  return PNG.sync.write(p);
};
test('算法要求两张牌各自的牌面水平位移，静止、只动一张或错误牌跨位必须拒绝',async()=>{
  const first=drawing([],true),end=drawing([0,0,0]);
  const positive=await showdownHorizontalEvidence(first,end,[first,drawing([0,20,40]),end],[1],layout);
  assert.deepEqual(positive.middleIndices,[1]);
  for(const shifts of [[0,0,0],[0,20,0],[0,0,40]]){
    const evidence=await showdownHorizontalEvidence(first,end,[first,drawing(shifts),end],[1],layout);
    assert.deepEqual(evidence.middleIndices,[],JSON.stringify(shifts));
  }
  for(const identities of [[0,2,1],[0,0,0]]) {
    const wrong=await showdownHorizontalEvidence(first,end,[first,drawing([0,20,40],false,identities),end],[1],layout);
    assert.deepEqual(wrong.middleIndices,[],`wrong card identities ${identities}`);
  }
});

test('起点timer排除不改原图、保留区域逐像素检查，牌型和终点不遮',()=>{
  const original=Buffer.from(images.first),p=PNG.sync.read(images.first),b=layout.timer,r=layout.region;
  for(let y=b.y-r.y;y<b.y-r.y+b.height;y++)for(let x=b.x-r.x;x<b.x-r.x+b.width;x++)
    p.data.set([255,0,0,255],(y*p.width+x)*4);
  const compared=compareShowdownStart(PNG.sync.write(p),images.first,layout);
  assert.equal(compared.distance,0);assert.equal(compared.samePixels,true);
  assert.deepEqual(images.first,original);
  // Pair's entire label is outside the timer and remains checked.
  p.data.set([255,255,255,255],((layout.label.y-r.y+10)*p.width+layout.label.x-r.x+10)*4);
  assert.equal(compareShowdownStart(PNG.sync.write(p),images.first,layout).samePixels,false);
  assert.ok(compareShowdownStart(images.first,images.end,layout).distance>10);
});

test('完整capture拒绝真实字体加载伪中途，原始截图和单次动作仍保留',async()=>{
  const full=bytes=>{
    const image=new PNG(screen),part=PNG.sync.read(bytes),r=layout.region;
    for(let i=0;i<image.data.length;i+=4)image.data.set([20,90,70,255],i);
    PNG.bitblt(part,image,0,0,part.width,part.height,r.x,r.y);
    return PNG.sync.write(image);
  };
  // Only the unchanged real ROI is relevant to capture; surrounding pixels
  // are a unit-test canvas, not an invented native screenshot or baseline.
  const first=full(images.first),middle=full(images['sprite-loading']),end=full(images.end);
  let observations=0,screenshots=0,triggers=0;const attachments=[];
  const device={screenSize:screen,nodes:async()=>observations++?after:before,
    nativeScreenshot:async()=>screenshots++?end:first};
  const previous=process.env.IOS_VISUAL_MODE;process.env.IOS_VISUAL_MODE='smoke';
  try {
    await assert.rejects(()=>captureNativeTransition(device,'zhajinhua-showdown-cards',
      {attach:async(name,item)=>attachments.push({name,...item})},
      {x:13,y:1392,width:278,height:204},()=>{triggers++;},[],[],0,'videoFrames',undefined,undefined,[],[],[],[],[],
      async(_device,_name,_region,trigger)=>{await trigger();return[first,middle,end];}),/第2张牌必须有自身牌面真实水平展开/);
    assert.equal(triggers,1);assert.equal(observations,2);assert.equal(screenshots,2);
    assert.deepEqual(PNG.sync.read(attachments.find(item=>item.name==='zhajinhua-showdown-cards-start').body).data,
      PNG.sync.read(images.first).data);
    assert.ok(attachments.some(item=>item.name==='zhajinhua-showdown-cards-horizontal-card-motion'));
  } finally {if(previous===undefined)delete process.env.IOS_VISUAL_MODE;else process.env.IOS_VISUAL_MODE=previous;}
});
