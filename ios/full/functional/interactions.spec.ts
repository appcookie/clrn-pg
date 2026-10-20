/** 真实 iOS 手势、分页、重试和客服草稿；没有 DOM 操作或强制点击。 */
import { expect } from '@playwright/test';
import { nativeTest } from './shared/register';
import { success } from './shared/api';
const source='kevinanew/clrn@3974319d1c72a964dad3d2c8d5862fbd255cc03b:e2e/interactions/';
nativeTest('interaction','INTERACTION-001 大厅滚动后回顶并打开搜索','signed-in',async ui=>{
  const before=await ui.node('slot-banner');await ui.scroll('down');
  const after=await ui.nodes('slot-banner');expect(after.length===0||Math.abs(after[0].bounds.y-before.bounds.y)>30,'真实滑动应改变内容位置').toBe(true);
  await ui.scroll('up',2);await expect.poll(async()=>Math.abs((await ui.node('slot-banner')).bounds.y-before.bounds.y)).toBeLessThan(5);
  await ui.tap('hall-search-button');await ui.visible('club-search-input');
},source+'scroll-and-controls.spec.ts');
nativeTest('interaction','INTERACTION-002 玩法弹层关闭重开与滑杆端点','signed-in',async ui=>{
  await ui.tap('private-room-tab');await ui.visible('copy-house-number-button');if(!(await ui.nodes('select-game-category-text')).length)await ui.tap('create-game-button');
  await ui.visible('select-game-category-text');const {width,height}=ui.device.screenSize;await ui.device.input.tap({x:width*.1,y:height*.2});await ui.absent('select-game-category-text');
  await ui.tap('create-game-button');await ui.tap('game-type-button-texas_react_native');await ui.absent('select-game-category-text');await ui.visible('base-create-room-screen');
  const slider=await ui.node({clazz:'XCUIElementTypeSlider'});const b=slider.bounds;const original=await ui.text('small-big-blind-value-text');
  await ui.device.input.swipe({x1:b.x+2,y1:b.y+b.height/2,x2:b.x+b.width-2,y2:b.y+b.height/2,duration:800});
  await expect.poll(()=>ui.text('small-big-blind-value-text')).not.toBe(original);const max=await ui.node({clazz:'XCUIElementTypeSlider'});expect(max.value).toMatch(/100%|^1(?:\.0)?$/);
  await ui.device.input.swipe({x1:b.x+b.width-2,y1:b.y+b.height/2,x2:b.x+2,y2:b.y+b.height/2,duration:800});
  const min=await ui.node({clazz:'XCUIElementTypeSlider'});expect(min.value).toMatch(/0%|^0(?:\.0)?$/);const value=(await ui.text('small-big-blind-value-text')).match(/^(\d+)\s*\/\s*(\d+)$/);
  expect(value).toBeTruthy();expect(Number(value![2])).toBe(Number(value![1])*2);
},source+'scroll-and-controls.spec.ts');
nativeTest('interaction','INTERACTION-003 俱乐部失败恢复后菜单可操作','signed-in',async ui=>{
  try{
    await ui.proxy.inject('club-failure');await ui.tap('club-tab');await ui.visible('club-list-load-error');const before=(await ui.proxy.status()).interceptedRequests;expect(before).toBeGreaterThan(0);await ui.proxy.clear();
    const response=await ui.network.waitForResponse({method:'GET',path:'/v10/club'},()=>ui.tap('club-list-retry-button'));success(response);expect(response.mocked).toBe(false);
    await ui.absent('club-list-load-error');await ui.visible('club-list-screen-flatlist');await ui.tap('show-more-button');await ui.visible('club-more-popup');
    await ui.tap('search-club-button');await ui.absent('club-more-popup');await ui.fill('club-search-input','IOS interaction');await ui.hasText('club-search-input','IOS interaction');
  }finally{await ui.proxy.clear();}
},source+'scroll-and-controls.spec.ts');
nativeTest('interaction','INTERACTION-004 大厅失败重试恢复操作','signed-in',async ui=>{
  try{
    await ui.proxy.inject('hall-timeout');await ui.device.restart();await ui.hall();await ui.visible('hall-api-error-alert');expect((await ui.proxy.status()).interceptedRequests).toBeGreaterThan(0);
    await ui.proxy.clear();success(await ui.network.waitForResponse({path:'/public/v1/hall_matching/available.json'},()=>ui.tap('hall-api-retry-button')));
    await ui.absent('hall-api-error-alert');await ui.tap('settings-tab');await ui.visible('settings-screen');
  }finally{await ui.proxy.clear();}
},source+'scroll-and-controls.spec.ts');
nativeTest('interaction','INTERACTION-005 我的虚拟列表后续菜单进入关于','signed-in',async ui=>{
  await ui.tap('settings-tab');await ui.visible('settings-list');const first=await ui.node('user-info-button');let swipes=0;
  while(!(await ui.nodes('about-laiwan')).length&&swipes<12){await ui.scroll('down');swipes++;}
  expect(swipes).toBeGreaterThan(0);const now=await ui.nodes('user-info-button');expect(!now.length||now[0].bounds.y<first.bounds.y).toBe(true);
  await ui.tap('about-laiwan');await ui.visible('current-server-text');
},source+'settings-scroll.spec.ts');
nativeTest('interaction','INTERACTION-006 我的列表末项完整进入视口','signed-in',async ui=>{
  await ui.tap('settings-tab');await ui.absent('sign-out');let swipes=0;while(!(await ui.nodes('sign-out')).length&&swipes<12){await ui.scroll('down');swipes++;}
  const node=await ui.node('sign-out');expect(node.bounds.y).toBeGreaterThanOrEqual(0);expect(node.bounds.y+node.bounds.height).toBeLessThanOrEqual(ui.device.screenSize.height);expect(swipes).toBeGreaterThan(0);
},source+'settings-scroll.spec.ts');
const applications=(start:number,count:number)=>Array.from({length:count},(_,i)=>({application_id:`interaction-${start+i}`,status:'approve',amount:100,user_id:'interaction-player',created_at:'2026-09-01T00:00:00Z',auditor_id:'interaction-auditor',nickname:`Scroll player ${start+i}`,building_name:'IOS interaction',room_name:'Paging game'}));
nativeTest('interaction','INTERACTION-007 横滑标签和游标分页追加、末页停止','signed-in',async ui=>{
  await ui.tap('message-tab');const initial=await ui.network.waitForResponse({method:'GET',path:/\/applications\/pending$/},()=>ui.tap('message-notification-item-buy-in'));success(initial);
  const pending=initial.path;const processed=pending.replace(/pending$/,'processed');await ui.back();
  const session=(await ui.network.sessions()).find(s=>s.userId===ui.requiredSession().userId);if(!session)throw new Error('分页夹具缺少本例会话');
  try{
    await ui.network.respond({method:'GET',path:pending,status:200,body:{ok:true,result:{applications:[],next_page:null}},session:session.key,times:5});
    await ui.network.respond({method:'GET',path:processed,status:200,body:{ok:true,result:{applications:applications(1,12),next_page:'interaction-page-2'}},session:session.key});
    await ui.network.respond({method:'GET',path:processed,status:200,body:{ok:true,result:{applications:applications(13,3),next_page:null}},session:session.key});
    const mark=await ui.network.mark();await ui.tap('message-notification-item-buy-in');await ui.selected({text:/^(Pending|Unprocessed|未处理|未處理)$/i},true);
    const screen=(await ui.node('game-buy-in-application-list-screen')).bounds;const y=screen.y+screen.height/2;
    await ui.device.input.swipe({x1:screen.x+screen.width*.8,y1:y,x2:screen.x+screen.width*.2,y2:y,duration:600});await ui.selected({text:/^(Processed|已处理|已處理)$/i},true);
    await ui.visible({text:'Scroll player 1'});const first=await ui.network.captured({after:mark,method:'GET',path:processed});expect(first.length).toBe(1);expect(new URL(first[0].url).searchParams.get('next_page')).toBeNull();
    for(let i=0;i<15&&!(await ui.nodes({text:'Scroll player 15'})).length;i++)await ui.scroll('down');await ui.count({text:'Scroll player 15'},1);await ui.count({text:'Scroll player 13'},1);
    const pages=await ui.network.captured({after:mark,method:'GET',path:processed});expect(pages.map(p=>new URL(p.url).searchParams.get('next_page'))).toEqual([null,'interaction-page-2']);expect(pages.every(p=>p.mocked)).toBe(true);
    // 原生虚拟列表会卸载首批；滚回首条证明追加并未覆盖，而非要求离屏节点保留。
    for(let i=0;i<15&&!(await ui.nodes({text:'Scroll player 1'})).length;i++)await ui.scroll('up');await ui.count({text:'Scroll player 1'},1);
    for(let i=0;i<15&&!(await ui.nodes({text:'Scroll player 15'})).length;i++)await ui.scroll('down');await ui.scroll('down',2);
    expect((await ui.network.captured({after:mark,method:'GET',path:processed})).map(p=>new URL(p.url).searchParams.get('next_page'))).toEqual([null,'interaction-page-2']);
  }finally{await ui.network.clearRules();}
},source+'pagination.spec.ts');
nativeTest('interaction','INTERACTION-008 真实原生客服草稿清空、关闭与重开','signed-in',async ui=>{
  await ui.settings('contact-us');await ui.visible('online-service-button');await ui.tap('online-service-button');
  const start=await ui.nodes({text:/^(New conversation|Start a conversation|Send us a message|新建对话|开始对话)$/i});if(start.length)await ui.tap({text:start[0].text});
  const editorSelector={clazz:'XCUIElementTypeTextView'};await ui.visible(editorSelector);await ui.count(editorSelector,1);
  const driver=ui.device.driver;const matches=await driver.request('POST',driver.path('/elements'),{using:'-ios class chain',value:'**/XCUIElementTypeTextView[`visible == 1`]'});
  expect(matches.length).toBe(1);const element=matches[0]['element-6066-11e4-a52e-4f735466cecf'];const draft='IOS Freshchat draft verification';
  await driver.request('POST',driver.path(`/element/${element}/value`),{text:draft});await ui.hasText(editorSelector,draft);
  await driver.request('POST',driver.path(`/element/${element}/clear`),{});await ui.hasText(editorSelector,'');
  await ui.back();await ui.visible('online-service-button');await ui.absent(editorSelector);await ui.tap('online-service-button');await ui.visible(editorSelector);await ui.count(editorSelector,1);await ui.hasText(editorSelector,'');await ui.back();await ui.visible('online-service-button');
},source+'freshchat.spec.ts');
