/** 只操作本轮创建的 staging 对象；先保存真实 UUID，再进行可能失败的页面断言。 */
import { expect } from '@playwright/test';
import type { NativeCase } from './case';
import { success, request, uuid, diamond, createAccount } from './api';
export async function createClub(ui: NativeCase, name: string) {
  const before=await diamond(ui.requiredSession()); await ui.settings('create-club');
  await ui.enabled('edit-club-header-right-complete',false); await ui.fill('edit-club-profile-input-name',name); await ui.enabled('edit-club-header-right-complete',false);
  const area='IOS staging tests'; await ui.fill('edit-club-profile-input-region',area); await ui.enabled('edit-club-header-right-complete',true);
  const response=await ui.network.waitForResponse({method:'POST',path:'/v3/pay_action/do'},()=>ui.tap('edit-club-header-right-complete'));
  const result=success(response); const clubId=result?.id||result?.club_id; expect(clubId).toMatch(uuid);
  expect(result.name).toBe(name); expect(result.area).toBe(area); await ui.visible('club-home-page-screen'); await ui.hasText('club-info-name',name);
  await ui.hasText('club-info-region-text',area); await ui.hasText('club-info-member-count','1'); await ui.hasText('club-profile-item-content-club_id',/^\d{9}$/);
  await ui.visible('club-rooms-empty-card'); await expect.poll(()=>diamond(ui.requiredSession())).toBe(before-50);
  const profile=success(await request(ui.requiredSession(),'GET',`/v10/club/${clubId}/profile`,undefined,new URL(response.url).origin));
  expect(profile.club_id).toBe(clubId); expect(profile.name).toBe(name); expect(profile.area).toBe(area); expect(profile.owner_id).toBe(ui.requiredSession().userId); expect(profile.member_count).toBe(1);
  await ui.hasText('club-profile-item-content-club_id',String(profile.club_no));
  return {clubId,name,origin:new URL(response.url).origin};
}
export async function createRoom(ui:NativeCase,name:string,clubId?:string){
  if(clubId) await ui.tap('club-profile-item-touchable-create_game');
  else {await ui.tap('private-room-tab');await ui.hasText('copy-house-number-button',/\d{9}/);await ui.tap('create-game-button');}
  await ui.tap('game-type-button-texas_react_native');await ui.visible('base-create-room-screen');await ui.fill('room-name-input',name);await ui.hasText('room-name-input',name);await ui.hasText('price-text','10');
  const response=await ui.network.waitForResponse({method:'POST',path:'/v3/pay_action/do'},()=>ui.tap('creat-room-button'));
  const result=success(response); if(!uuid.test(result?.room_id||''))throw new Error('建房成功响应未含真实 UUID');
  // 此后所有断言必须由调用者放在 finally 清理范围内。
  return {roomId:result.room_id as string,result,origin:new URL(response.url).origin};
}
export async function expectRoom(ui:NativeCase,name:string){await ui.visible('run-game-view');await ui.hasText('texas-holdem-room-name-text',name);await ui.hasText('countdown-text',/waiting|等待/i);}
export async function members(ui:NativeCase,clubId:string){
  if(!uuid.test(clubId))throw new Error('非法本例俱乐部UUID'); const result=success(await request(ui.requiredSession(),'GET',`/v10/club/${clubId}/member`));
  expect(Array.isArray(result?.members)).toBe(true);return result.members as {id:string}[];
}
export async function secondary(ui:NativeCase){const created=await createAccount();const child=await ui.secondary();try{const session=await child.signIn(created);expect(session.userId).toBe(created.userId);expect(await diamond(session)).toBe(0);return child;}catch(error){await child.device.close();throw error;}}
export async function apply(ui:NativeCase,clubId:string){success(await request(ui.requiredSession(),'POST',`/v10/club/${clubId}/application`));}
export async function approveApi(owner:NativeCase,guest:NativeCase,clubId:string){
  await apply(guest,clubId);const result=success(await request(owner.requiredSession(),'GET','/v10/club/application'));
  expect(Array.isArray(result?.applications)).toBe(true);const pending=result.applications.find((a:any)=>a.club_id===clubId&&a.user_id===guest.requiredSession().userId&&a.permitted===null);
  expect(pending?.application_id).toMatch(uuid);success(await request(owner.requiredSession(),'POST',`/v10/club/application/${pending.application_id}`,{action:'approve'}));
  await expect.poll(async()=>(await members(owner,clubId)).some(m=>m.id===guest.requiredSession().userId)).toBe(true);
}
export async function leave(guest:NativeCase,clubId:string){success(await request(guest.requiredSession(),'DELETE',`/v10/club/${clubId}/member/${guest.requiredSession().userId}`));}
