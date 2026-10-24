import { PNG } from 'pngjs';
import { setImmediate } from 'node:timers/promises';
import { flattenNodes, type NativeNode } from './game-controls';
import { playerCountdownNodes } from './game-countdown';
import type { ScreenshotBounds } from './screenshot';

const shown = (node: NativeNode) => node.visible !== false;
const inside = (a: ScreenshotBounds, b: ScreenshotBounds) => a.x >= b.x && a.y >= b.y
  && a.x + a.width <= b.x + b.width && a.y + a.height <= b.y + b.height;
function one(nodes: NativeNode[], description: string) {
  if (nodes.length !== 1) throw new Error(`摊牌必须有唯一${description}`);
  return nodes[0];
}
export type ShowdownLayout = {
  region: ScreenshotBounds; timer: ScreenshotBounds; cards: ScreenshotBounds[]; label: ScreenshotBounds;
};

/** The three native sprite wrappers are siblings of the AX cards marker.
 * Their sprite metadata is AX-hidden under the visible card cover. Require
 * the actual visible wrappers/covers; never rewrite that metadata visibility.
 */
export function zhajinhuaShowdownLayout(before: NativeNode[], after: NativeNode[],
  screen: { width: number; height: number }): ShowdownLayout {
  const actor = one(before.filter(node => shown(node)
    && /^zhajinhua-player-container-.+-operating$/.test(node.res || '')), '起点行动玩家');
  const id = actor.res!.replace(/-operating$/, '');
  const target = one(after.filter(node => shown(node) && (node.res === id || node.res === `${id}-operating`)), '同一终点玩家');
  if (flattenNodes(actor).some(node => shown(node) && node.res === 'player_cards_container'))
    throw new Error('摊牌起点不得已经出现目标三牌');
  const container = one(flattenNodes(target).filter(node => shown(node) && node.res === 'player_cards_container'), '完整三牌容器');
  const wrappers = (target.children || []).filter(node => shown(node) && !node.res && node.enabled !== false
    && (node.children || []).some(child => child.res === 'sprite-image-content'));
  if (wrappers.length !== 3) throw new Error('摊牌终点必须有三个实际牌面包装节点');
  const cards = wrappers.map(wrapper => {
    const children = wrapper.children || [];
    const content = one(children.filter(node => node.res === 'sprite-image-content'), '牌面内容');
    const backing = one(children.filter(node => node.res === 'sprite-image-container'), '牌面范围');
    one(children.filter(node => node.res === 'sprite-image-clipper'), '牌面裁切节点');
    const cover = one(children.filter(node => !node.res && shown(node) && !(node.children || []).length), '实际可见牌面覆盖层');
    if (!inside(content.bounds, wrapper.bounds) || JSON.stringify(content.bounds) !== JSON.stringify(backing.bounds)
      || JSON.stringify(content.bounds) !== JSON.stringify(cover.bounds)) throw new Error('摊牌可见覆盖层必须对应完整原生牌面');
    return content.bounds;
  }).sort((a,b) => a.x-b.x);
  const [first,second,third] = cards;
  if (cards.some(card => Math.abs(card.y-first.y)>2 || Math.abs(card.height-first.height)>2
    || Math.abs(card.width-first.width)>6)
    || [second.x-first.x,third.x-second.x].some(gap => gap < first.width*.6 || gap > first.width*.85))
    throw new Error('三牌必须具有原生等间距水平展开的完整终点');
  const label = one((target.children || []).filter(node => shown(node) && node.text && node.res === node.text
    && node.bounds.y >= first.y+first.height && node.bounds.height <= target.bounds.height/3
    && node.bounds.x >= target.bounds.x && node.bounds.x+node.bounds.width <= target.bounds.x+target.bounds.width), '完整牌型标签');
  const timer = one(playerCountdownNodes([actor], 'zhajinhua'), '真实起点倒计时').bounds;
  const all = [container.bounds,...wrappers.map(node=>node.bounds),label.bounds,timer];
  if (all.some(bounds => ![bounds.x,bounds.y,bounds.width,bounds.height].every(Number.isInteger)
    || bounds.width<=0 || bounds.height<=0 || !inside(bounds,{x:0,y:0,...screen})))
    throw new Error('三牌、牌型及倒计时必须完整位于屏幕内');
  if (timer.width*timer.height > screen.width*screen.height*.12) throw new Error('起点倒计时超过全屏12%限制');
  const x=Math.max(0,Math.min(...all.map(b=>b.x))-4),y=Math.max(0,Math.min(...all.map(b=>b.y))-4);
  const region={x,y,width:Math.min(screen.width,Math.max(...all.map(b=>b.x+b.width))+4)-x,
    height:Math.min(screen.height,Math.max(...all.map(b=>b.y+b.height))+4)-y};
  return {region,timer,cards,label:label.bounds};
}

/** The timer is excluded only from first-frame and exact start-baseline
 * comparisons. Average retained pixels, preserving all cards/label at end.
 */
export function compareShowdownStart(left: Buffer, right: Buffer, layout: ShowdownLayout) {
  const a=PNG.sync.read(left),b=PNG.sync.read(right),{region,timer}=layout;
  if (a.width!==b.width || a.height!==b.height || a.width!==region.width || a.height!==region.height)
    throw new Error('摊牌起点必须对应完整原生范围');
  let difference=0,pixels=0,exact=true;
  for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++) {
    const sx=x+region.x,sy=y+region.y;
    if(sx>=timer.x&&sx<timer.x+timer.width&&sy>=timer.y&&sy<timer.y+timer.height)continue;
    pixels++;
    const offset=(y*a.width+x)*4;
    for(let channel=0;channel<4;channel++) {
      const delta=Math.abs(a.data[offset+channel]-b.data[offset+channel]);
      if(channel<3)difference+=delta;
      if(delta>12)exact=false;
    }
  }
  if(!pixels)throw new Error('摊牌起点不得排除全部像素');
  return {distance:difference/(pixels*3),samePixels:exact,comparedPixels:pixels,excludedPixels:a.width*a.height-pixels};
}

type Pixels = ReturnType<typeof PNG.sync.read>;
function patchDistance(frame: Pixels, reference: Pixels, patch: ScreenshotBounds, x: number) {
  let difference=0;
  for(let row=0;row<patch.height;row++)for(let column=0;column<patch.width;column++) {
    const a=((patch.y+row)*frame.width+x+column)*4;
    const b=((patch.y+row)*reference.width+patch.x+column)*4;
    for(let c=0;c<3;c++)difference+=Math.abs(frame.data[a+c]-reference.data[b+c]);
  }
  return difference/(patch.width*patch.height*3);
}

/** Track each different rank/suit patch horizontally against its own endpoint.
 * A fade, changed sprite sizing, or another card crossing this slot cannot
 * supply this card's translated identity. The first card itself has no
 * horizontal animation in Player._renderCards; require its appearance only.
 */
export async function showdownHorizontalEvidence(before: Buffer, after: Buffer, frames: Buffer[],
  indices: number[], layout: ShowdownLayout) {
  const start=PNG.sync.read(before),end=PNG.sync.read(after);
  const decoded=new Map<number,Pixels>();
  for (const index of indices) {
    decoded.set(index,PNG.sync.read(frames[index]));
    await setImmediate();
  }
  const last=PNG.sync.read(frames.at(-1)!);
  if ([start,end,last,...decoded.values()].some(image=>image.width!==layout.region.width||image.height!==layout.region.height))
    throw new Error('三牌运动必须使用完整原生范围');
  const patches=layout.cards.map(card=>({x:card.x-layout.region.x+Math.floor(card.width*.1),
    y:card.y-layout.region.y+Math.floor(card.height*.08),width:Math.floor(card.width*.35),height:Math.floor(card.height*.8)}));
  for(const patch of patches) {
    let contrast=0;
    for(let channel=0;channel<3;channel++) {
      let low=255,high=0;
      for(let row=0;row<patch.height;row++)for(let column=0;column<patch.width;column++) {
        const value=end.data[((patch.y+row)*end.width+patch.x+column)*4+channel];
        low=Math.min(low,value);high=Math.max(high,value);
      }
      contrast=Math.max(contrast,high-low);
    }
    if(contrast<40)throw new Error('每张牌必须有实际可识别牌面，空白色块不能代替');
    if(patchDistance(start,end,patch,patch.x)<=10)throw new Error('起点不得已含摊牌牌面');
    if(patchDistance(last,end,patch,patch.x)>=10)throw new Error('原片终点必须有完整的每张牌面');
  }
  const cards:{card:number;patch:ScreenshotBounds;travel:number;
    candidates:{index:number;x:number;distance:number;endpointDistance:number}[]}[]=[];
  for (const [index,patch] of patches.slice(1).entries()) {
    const travel=layout.cards[index+1].x-layout.cards[0].x;
    const candidates:{index:number;x:number;distance:number;endpointDistance:number}[]=[];
    const lower=Math.ceil(patch.x-travel*.65),upper=Math.floor(patch.x-Math.max(4,travel*.1));
    for(const [frameIndex,frame] of decoded) {
      const endpointDistance=patchDistance(frame,end,patch,patch.x);
      let best={x:patch.x,distance:endpointDistance};
      for(let x=lower;x<=upper;x++) {
        const distance=patchDistance(frame,end,patch,x);
        if(distance<best.distance)best={x,distance};
      }
      if(best.x!==patch.x && best.distance<10 && endpointDistance-best.distance>3)
        candidates.push({index:frameIndex,...best,endpointDistance});
      await setImmediate();
    }
    cards.push({card:index+2,patch,travel,candidates});
  }
  const shared=indices.filter(index=>cards.every(card=>card.candidates.some(candidate=>candidate.index===index)));
  return {cards,middleIndices:shared};
}
