/** 六个真实建房/俱乐部案例（第七个创建案例 AUTH007 位于 auth.spec.ts）。 */
import { expect } from '@playwright/test';
import { register } from './shared/register';
import { success, request, diamond, deleteRoom } from './shared/api';
import { createClub, createRoom, expectRoom, members, secondary, apply, approveApi, leave } from './shared/creation';
import type { NativeCase } from './shared/case';
const name=(prefix:string)=>`${prefix}${Date.now().toString(36)}`;
register('CLUB-001',0,'creation',async ui=>{await createClub(ui,name('IOSClub'));});
register('CLUB-002',0,'creation',async ui=>{
  const before=await diamond(ui.requiredSession());const club=await createClub(ui,name('IOSClub'));const roomName=name('IOSRoom');let roomId:string|undefined;
  try{const room=await createRoom(ui,roomName,club.clubId);roomId=room.roomId;
    expect(room.result.building_type).toBe('club');expect(room.result.building_id).toBe(club.clubId);expect(room.result.creator_id).toBe(ui.requiredSession().userId);expect(room.result.room_name).toBe(roomName);
    await expectRoom(ui,roomName);await ui.hasText('texas-holdem-room-type-text',club.name);await expect.poll(()=>diamond(ui.requiredSession())).toBe(before-60);
  }finally{if(roomId){await deleteRoom(ui.requiredSession(),roomId);await expect.poll(()=>diamond(ui.requiredSession())).toBe(before-50);}}
});
register('PRIVATE-001',0,'creation',async ui=>{
  const before=await diamond(ui.requiredSession());const roomName=name('IOSPrivate');let roomId:string|undefined;let removed=false;
  try{const room=await createRoom(ui,roomName);roomId=room.roomId;await expectRoom(ui,roomName);await ui.hasText('texas-holdem-room-type-text',/private|私人/i);
    await expect.poll(()=>diamond(ui.requiredSession())).toBe(before-10);await ui.tap('menu-button');await ui.tap('drawer-menu-item-exit');
    await ui.count(`private-room-${roomId}`,1);await ui.hasText('personal-house-timer',/waiting|等待/i);await ui.tap('close-room-button');
    await ui.visible('private-room-confirm-popup');const response=await ui.network.waitForResponse({method:'DELETE',path:`/v1/room/${roomId}`},()=>ui.tap('confirm-button'));
    success(response);removed=true;await ui.visible('create-game-button');await ui.absent(`private-room-${roomId}`);await expect.poll(()=>diamond(ui.requiredSession())).toBe(before);
  }finally{if(roomId&&!removed){await deleteRoom(ui.requiredSession(),roomId);await expect.poll(()=>diamond(ui.requiredSession())).toBe(before);}}
});
register('PRIVATE-003',0,'creation',async ui=>{
  const before=await diamond(ui.requiredSession());const roomName=name('IOSJoin');let roomId:string|undefined;let guest:NativeCase|undefined;
  try{const room=await createRoom(ui,roomName);roomId=room.roomId;await expectRoom(ui,roomName);await ui.tap('menu-button');await ui.tap('drawer-menu-item-exit');
    await ui.visible(`private-room-${roomId}`);await expect.poll(()=>diamond(ui.requiredSession())).toBe(before-10);
    const number=(await ui.text('copy-house-number-button')).match(/\d{9}/)?.[0];expect(number).toMatch(/^\d{9}$/);
    guest=await secondary(ui);await guest.tap('private-room-tab');await guest.tap('personal-house-join');await guest.fill('personal-room-smooth-pin-code-input',number!);await guest.enabled('join-game-button',true);
    await guest.tap('join-game-button');await expectRoom(guest,roomName);await guest.hasText('texas-holdem-room-type-text',/private|私人/i);
    await guest.tap('menu-button');await guest.tap('drawer-menu-item-exit');await guest.visible('house-section-list');
  }finally{try{await guest?.device.close();}finally{if(roomId){await deleteRoom(ui.requiredSession(),roomId);await expect.poll(()=>diamond(ui.requiredSession())).toBe(before);}}}
});
register('CLUB-004',0,'creation',async ui=>{
  const club=await createClub(ui,name('IOSMembers'));const guests:NativeCase[]=[];const joined=new Set<string>();
  try{
    for(let i=0;i<2;i++){const guest=await secondary(ui);guests.push(guest);joined.add(guest.requiredSession().userId);await approveApi(ui,guest,club.clubId);}
    await expect.poll(async()=>(await members(ui,club.clubId)).length).toBe(3);await ui.tap('club-profile-item-touchable-member_management');
    for(const guest of guests)await ui.visible(`club-member-item-${guest.requiredSession().userId}`);
    const remove=async(guest:NativeCase,count:number)=>{
      const id=guest.requiredSession().userId;await ui.tap('club-member-edit-button');await ui.visible('club-member-edit-mode');await ui.tap(`club-member-item-${id}`);await ui.visible(`club-member-remove-selected-${id}`);
      await ui.tap('club-member-remove-mode-button');await ui.visible('club-member-remove-confirm-dialog');
      success(await ui.network.waitForResponse({method:'DELETE',path:`/v10/club/${club.clubId}/member/${id}`},()=>ui.tap('club-member-remove-confirm-button')));
      joined.delete(id);await ui.visible('club-member-normal-mode');await ui.absent(`club-member-item-${id}`);
      await expect.poll(async()=>(await members(ui,club.clubId)).length).toBe(count);await ui.count(/^club-member-item-[0-9a-f-]{36}$/,count);
    };
    await remove(guests[0],2);await ui.tap('club-member-edit-button');const second=guests[1].requiredSession().userId;await ui.tap(`club-member-item-${second}`);await ui.visible(`club-member-remove-selected-${second}`);
    await ui.tap('club-member-cancel-button');await ui.visible(`club-member-item-${second}`);await ui.count(/^club-member-item-[0-9a-f-]{36}$/,2);
    expect((await members(ui,club.clubId)).some(m=>m.id===second)).toBe(true);await remove(guests[1],1);expect((await members(ui,club.clubId)).map(m=>m.id)).toEqual([ui.requiredSession().userId]);
  }finally{
    try{const failures=[];for(const guest of guests)if(joined.has(guest.requiredSession().userId)){try{if((await members(ui,club.clubId)).some(m=>m.id===guest.requiredSession().userId))await leave(guest,club.clubId);}catch(e){failures.push(e);}}
      if(failures.length)throw new AggregateError(failures,'本例俱乐部成员清理失败');await expect.poll(async()=>(await members(ui,club.clubId)).length).toBe(1);
    }finally{for(const guest of guests)await guest.device.close();}
  }
});
register('CLUB-005',0,'creation',async ui=>{
  const club=await createClub(ui,name('IOSJoinClub'));const guests:NativeCase[]=[];const joined=new Set<string>();
  const isMember=async(guest:NativeCase)=>(await members(ui,club.clubId)).some(m=>m.id===guest.requiredSession().userId);
  const ownClubs=async(guest:NativeCase)=>success(await request(guest.requiredSession(),'GET',`/v10/club?user_id=${guest.requiredSession().userId}`)).clubs.some((c:any)=>c.id===club.clubId);
  const review=async(guest:NativeCase,approved:boolean)=>{
    await ui.tap('club-profile-item-touchable-club_notification');await ui.visible('club-notification-screen');const id=guest.requiredSession().userId;await ui.visible(`club-notification-item-${id}`);
    const response=await ui.network.waitForResponse({method:'POST',path:/^\/v10\/club\/application\//},()=>ui.tap(`${approved?'agree':'refuse'}-button-${id}`));
    success(response);expect(response.requestBody).toEqual({action:approved?'approve':'reject'});await ui.visible(approved?'approved-text':'rejected-text');
    if(approved)joined.add(id);await expect.poll(()=>isMember(guest)).toBe(approved);await expect.poll(()=>ownClubs(guest)).toBe(approved);
    await ui.back();await ui.visible('club-home-page-screen');
  };
  try{
    const applicant=await secondary(ui);guests.push(applicant);await applicant.tap('hall-search-button');const response=await applicant.submitSearch(club.name);expect(success(response)).toContain(club.clubId);
    await applicant.count('club-search-item-touchable',1);await applicant.hasText('club-search-item-name',club.name);await applicant.tap('club-search-item-touchable');await applicant.hasText('club-info-name',club.name);
    success(await applicant.network.waitForResponse({method:'POST',path:`/v10/club/${club.clubId}/application`},()=>applicant.tap('club-application-join-button-touchable')));
    await applicant.hasText('club-application-join-button-text',/applied|requested|已申请|已申請/i);expect(await isMember(applicant)).toBe(false);await review(applicant,true);
    const invitee=await secondary(ui);guests.push(invitee);const generated=success(await request(ui.requiredSession(),'PUT','/v1/share_link/generate',{payload:{club_id:club.clubId}}));
    const link=new URL(generated.share_link);expect(link.origin).toBe('https://shafayouxi.org');const code=link.pathname.match(/^\/laiwan\/([A-Za-z0-9]{7})$/)?.[1];expect(code).toBeTruthy();
    const parsed=success(await request(undefined,'GET',`/v1/share_link/parse_code?code=${encodeURIComponent(code!)}`,undefined,club.origin));expect(parsed.action).toBe('new_club_application');expect(parsed.params.club_id).toBe(club.clubId);
    await apply(invitee,club.clubId);expect(await isMember(invitee)).toBe(false);await review(invitee,true);await expect.poll(async()=>(await members(ui,club.clubId)).length).toBe(3);
    const rejected=await secondary(ui);guests.push(rejected);await apply(rejected,club.clubId);await review(rejected,false);expect(await isMember(rejected)).toBe(false);expect(await ownClubs(rejected)).toBe(false);
  }finally{
    try{for(const guest of guests)if(joined.has(guest.requiredSession().userId))await leave(guest,club.clubId);await expect.poll(async()=>(await members(ui,club.clubId)).length).toBe(1);}
    finally{for(const guest of guests)await guest.device.close();}
  }
});
