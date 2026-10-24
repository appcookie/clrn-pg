import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { collectPlaywright } from '../../scripts/playwright-collection.mjs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { webVisualMapping } from './web-visual-map.ts';
import { requireFade } from './web-animation-parity.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = JSON.parse(readFileSync(new URL('../../docs/web-coverage-source.json', import.meta.url), 'utf8'));
function collect(locale) {
  const report = JSON.parse(collectPlaywright(['--config','ios/full/playwright.config.ts','tests/','--list','--reporter=json'],
    { cwd: root, encoding: 'utf8', env: { ...process.env, IOS_LOCALE: locale, IOS_GROUP: 'all' }, stdio: ['ignore','pipe','pipe'], timeout: 60_000 }));
  const specs=[]; const visit = suite => { specs.push(...(suite.specs || [])); for(const child of suite.suites || [])visit(child); };
  report.suites.forEach(visit); return specs;
}
test('Web91流程260状态逐个对应实际注册的三语言原生测试，level_up明确采用动画替代', () => {
  const expected = source.visualMobileFlows.flatMap(row => row.snapshotStates.map(state => `${row.pageLabel}/${state}`)).sort();
  assert.equal(source.visualMobileFlows.length,91); assert.equal(expected.length,260);
  for(const locale of ['en','zh-Hans','zh-Hant']) {
    const mapping=webVisualMapping(locale), specs=collect(locale);
    assert.deepEqual(mapping.map(row=>`${row.pageLabel}/${row.state}`).sort(),expected);
    for(const row of mapping) {
      const found=specs.find(spec=>spec.title===row.title && spec.file.endsWith(row.file.replace('ios/full/','')));
      assert.ok(found,`${locale} ${row.pageLabel}/${row.state}: 未注册执行器 ${row.title}`);
      assert.equal(found.tests[0].expectedStatus,'passed');
    }
    assert.deepEqual(mapping.filter(row=>row.capture==='animated-level-up').map(row=>`${row.pageLabel}/${row.state}`),
      locale==='en'?['signed_in_texas_hall/level_up']:[]);
  }
});
test('Web21动画精确标题都有实际注册的英文原生执行入口及平台差异',()=>{
  assert.equal(source.animations.length,21); const byLocale=new Map();
  for(const row of source.animations){
    const target=row.nativeImplementation; assert.ok(target, row.title);
    assert.equal(target.locale,'en',`${row.title}: 动画仅保留英文`);
    if(!byLocale.has(target.locale))byLocale.set(target.locale,collect(target.locale));
    const found=byLocale.get(target.locale).find(spec=>spec.title===target.testTitle&&spec.file.endsWith(target.file.replace('ios/full/','')));
    assert.ok(found,`${row.title}: 缺少真实注册 ${target.testTitle}`); assert.equal(found.tests[0].expectedStatus,'passed');
    assert.ok(target.platformChanges);
  }
});
test('淡入像素拟合拒绝静止终态、突然跳变和无关闪屏',()=>{
  const frame=(alpha,flash=false)=>{const p=new PNG({width:20,height:20});for(let y=0;y<20;y++)for(let x=0;x<20;x++){
    const i=(y*20+x)*4;const ink=x>=5&&x<15&&y>=4&&y<16; const v=flash?100:Math.round(20+(ink?200*alpha:0));
    p.data[i]=p.data[i+1]=p.data[i+2]=v;p.data[i+3]=255;}return PNG.sync.write(p);};
  assert.ok(requireFade([0,.2,.5,.8,1].map(a=>frame(a))).middle>0);
  assert.throws(()=>requireFade([frame(1),frame(1),frame(1)]));
  assert.throws(()=>requireFade([frame(0),frame(0),frame(1)]));
  assert.throws(()=>requireFade([frame(0),frame(.5,true),frame(.5,true),frame(1)]));
});
