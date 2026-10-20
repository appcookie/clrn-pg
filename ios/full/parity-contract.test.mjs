import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenarios } from '../../visual/scenarios.ts';
import { texasScenarioLabels } from './texas-flows.ts';
import { recordStates } from './record-states.ts';
import { gameNodes, gameSemanticText } from './game-controls.ts';
import { screenBounds } from './screen-geometry.ts';

const cases = buildScenarios({ VISUAL_LOCALES: 'en', VISUAL_SCOPE: 'full', VISUAL_SUITE: 'all' }).filter(s => s.viewport.label === 'mobile');
test('原生牌桌编排分派完整覆盖德州95状态、拼三张26状态与战绩62状态', () => {
  const texas = cases.filter(s => s.group === 'texas-holdem');
  assert.deepEqual([...texasScenarioLabels].sort(), texas.map(s => s.pageLabel).sort());
  assert.equal(texas.reduce((n,s) => n + s.snapshotStates.length, 0), 95);
  assert.equal(cases.filter(s => s.group === 'zhajinhua').reduce((n,s) => n + s.snapshotStates.length, 0), 26);
  for (const version of ['legacy','v2']) assert.deepEqual(recordStates[version], cases.find(s => s.pageLabel === `signed_in_game_records_${version}`).snapshotStates);
  assert.equal(recordStates.legacy.length + recordStates.v2.length, 62);
});

test('原生驱动断连不能变为空页面，页面边界按iOS实际截图计算', async () => {
  await assert.rejects(gameNodes({ nodes: async () => { throw new Error('driver disconnected'); } }), /disconnected/);
  const a={res:'visible',bounds:{x:900,y:2300,width:100,height:100}};
  const b={res:'old',bounds:{x:0,y:2600,width:100,height:100}};
  assert.deepEqual(await gameNodes({screenSize:{width:1170,height:2532},nodes:async()=>[a,b]}),[a]);
  assert.equal(gameSemanticText({res:'card',children:[{res:'name',text:'ah'}]}, 'name'),'ah');
});

test('动画区域映射保留原始iOS像素范围', () => {
  assert.deepEqual(screenBounds({screenSize:{width:1170,height:2532}}, {x:0,y:0,width:720,height:1280}),
    {x:0,y:0,width:1170,height:2532});
});

test('iOS面板裁切采用实际容器位置，含safe area偏移；退出采用触发前边界', async () => {
  const { animationRegion } = await import('./animation-region.ts');
  const node = { res:'game-settings-popup-container', bounds:{x:140,y:620,width:900,height:1200} };
  const fallback = {x:0,y:0,width:100,height:100};
  const device = {screenSize:{width:1170,height:2532}};
  const enter = animationRegion('texas-holdem-settings-enter',[],[node],device,fallback);
  assert.deepEqual(enter.bounds, {x:136,y:616,width:908,height:1208});
  assert.deepEqual(animationRegion('texas-holdem-settings-exit',[node],[],device,fallback),enter);
});

test('尚未校准的Android比例遮罩不能遮掉iOS真实像素', async () => {
  const { PNG } = await import('pngjs');
  const { maskScreenshot } = await import('./screenshot.ts');
  const png=new PNG({width:117,height:253}); png.data.fill(120);
  const bytes=PNG.sync.write(png);
  const device={screenSize:{width:117,height:253}};
  const inferred=screenBounds(device,{x:20,y:20,width:40,height:40,reason:'旧平台位置'});
  assert.deepEqual(PNG.sync.read(maskScreenshot(bytes,[inferred])).data,png.data);
  const actual={x:20,y:20,width:4,height:4,reason:'真实iOS动态节点'};
  assert.notDeepEqual(PNG.sync.read(maskScreenshot(bytes,[actual])).data,png.data);
});

test('游戏树附件不能泄漏历史登录输入值或底层attributes', async () => {
  const { safeNativeTree } = await import('./diagnostics.ts');
  const output=JSON.stringify(safeNativeTree([{res:'game',children:[
    {res:'password-input',text:'sensitive-example',attributes:{value:'sensitive-example'}},
    {clazz:'XCUIElementTypeSecureTextField',text:'another-example'},
    {res:'community_card_name_text',text:'ah'},
  ]}]));
  assert.equal(output.includes('sensitive-example'),false);
  assert.equal(output.includes('another-example'),false);
  assert.equal(output.includes('attributes'),false);
  assert.equal(output.includes('ah'),true);
});
