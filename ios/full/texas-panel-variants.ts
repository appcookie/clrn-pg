import { screenBounds } from './screen-geometry';
import { expect } from '@playwright/test';
import { REPLAY_PLAYER_IDS } from '../../visual/cases/texas-holdem/replayData';
import { gameConnected, gameGone, gameNodes, gameReady, gameTap } from './game-controls';
import { closeGameMask } from './game-pregame';
import { replay } from './game-replay';
import { captureNativeTransition } from './animation-transition';
import { enableGameSetting, restoreTexas, texasEvents, type TexasContext } from './texas-support';

/**
 * 复用 Web 的申请分页、音频历史、弹幕开关及三种 RPC 错误状态。
 * @param context - 当前真实房间、连接与共用顺序截图入口。
 */
export async function texasPanelVariants(context: TexasContext): Promise<void> {
  const { device, proxy, room, self, capture, animationInfo } = context;
  const alertRegion = screenBounds(device, { x: 80, y: 525, width: 560, height: 265 });
  const alertMasks = [
    screenBounds(device, { x: 270, y: 720, width: 180, height: 28, reason: '错误弹窗下方的牌局倒计时独立跳秒' }),
    screenBounds(device, { x: 80, y: 690, width: 55, height: 100, reason: '弹窗左侧的玩家倒计时独立跳秒' }),
  ];
  const tableBackMasks = [
    screenBounds(device, { x: 260, y: 225, width: 50, height: 55, reason: '弹窗背后的对手背牌会随牌桌回放异步显隐' }),
    screenBounds(device, { x: 16, y: 550, width: 54, height: 70, reason: '弹窗背后的对手背牌会随牌桌回放异步显隐' }),
    screenBounds(device, { x: 16, y: 745, width: 54, height: 60, reason: '弹窗背后的对手背牌会随牌桌回放异步显隐' }),
  ];
  const ownTurnMasks = [
    screenBounds(device, { x: 207, y: 1020, width: 275, height: 34, reason: '弹窗背后的本人回合标识会独立切换' }),
    screenBounds(device, { x: 207, y: 1054, width: 148, height: 148, reason: '弹窗背后的本人头像与筹码状态会独立切换' }),
  ];
  /** 事先读取按钮边界，使点击落在原生采样窗口内。
   * @param resource - 当前实际可见的原生按钮资源标识。
   */
  const press = async (resource: string) => {
    await gameConnected(device);
    const { bounds } = await gameReady(device, resource);
    return () => device.input.tap({ x: Number(String(Math.round(bounds.x + bounds.width / 2))), y: Number(String(Math.round(bounds.y + bounds.height / 2))) });
  };
  await restoreTexas(context);
  for (const mode of ['pending', 'resolved', 'more'] as const) {
    await proxy.command('texas/ui', { applications: mode });
    await gameTap(device, 'buy-in-application-button');
    await expect.poll(async () => (await gameNodes(device)).filter(node => node.res === 'buy-in-application-nickname').length,
      { timeout: 30_000 }).toBe(mode === 'resolved' ? 3 : 2);
    if (mode === 'pending') expect((await gameNodes(device)).filter(node => node.res === 'buy-in-approved-applications-tab')).toHaveLength(2);
    if (mode === 'resolved') expect((await gameNodes(device)).filter(node => node.res === 'buy-in-application-status')).toHaveLength(3);
    if (mode === 'more') expect((await gameReady(device, 'buy-in-application-list-more')).enabled).toBe(true);
    await capture(`applications_${mode}`, [tableBackMasks[0], ...ownTurnMasks]);
    await closeGameMask(device, 'buy-in-application-list');
  }
  await enableGameSetting(device, 'player-voice');
  await replay(proxy, 'texas', room, { stream: 'room_message', payload: { action: 'audio', content: {
    from_user_id: REPLAY_PLAYER_IDS[0], from_user_nickname: 'Player1', duration: 3, codec: 'mp3', content: '',
  } } });
  await gameTap(device, 'texas-holdem-chat-button');
  await gameTap(device, '-in-game-chat-record-tab');
  await gameReady(device, 'in-game-chat-audio-message-0');
  await capture('chat_audio_history', tableBackMasks);
  await gameTap(device, 'in-game-chat-barrage-switch');
  await capture('chat_barrage_off', tableBackMasks);
  const chat = (await gameReady(device, 'in-game-chat-mask')).bounds;
  await device.input.tap({ x: Number(String(chat.x + 8)), y: Number(String(chat.y + 80)) });
  await gameGone(device, 'in-game-chat-container');
  await proxy.command('texas/ui', { rpcError: 'retry' });
  await gameConnected(device);
  if (animationInfo) await captureNativeTransition(device, 'texas-alert-retry-enter', animationInfo,
    alertRegion, await press('texas-holdem-operation-button-call'), alertMasks, [], 0, 'videoFrames');
  else await gameTap(device, 'texas-holdem-operation-button-call');
  expect((await gameReady(device, 'common-alert-message')).text).toContain('Please retry');
  // 操作错误弹窗没有 buttonId；与 Web 一样按真实按钮文字校验和操作。
  await expect.poll(async () => (await gameNodes(device)).some(node => /^(Retry|重试|重試)$/.test(node.text || '')),
    { timeout: 30_000 }).toBe(true);
  await capture('alert_retry', [...tableBackMasks,
    { ...ownTurnMasks[0], y: Math.round(device.screenSize.height * 1010 / 1280), height: Math.round(device.screenSize.height * 44 / 1280) }, ownTurnMasks[1]]);
  if (animationInfo) {
    const cancel = await device.info({ text: /^(取消|Cancel)$/ });
    await captureNativeTransition(device, 'texas-alert-retry-exit', animationInfo, alertRegion,
      () => device.input.tap({ x: Number(String(Math.round(cancel.bounds.x + cancel.bounds.width / 2))), y: Number(String(Math.round(cancel.bounds.y + cancel.bounds.height / 2))) }), alertMasks, [], 0, 'videoFrames');
  } else await device.tap({ text: /^(取消|Cancel)$/ });
  await restoreTexas(context, {}, 'flop', true);
  await proxy.command('texas/ui', { rpcError: 'balance' });
  await texasEvents(context, [{ event: 'settlement', players: [{ player_id: self, net: 180, prize: 180, stack: 1180 }] }]);
  if (animationInfo) await captureNativeTransition(device, 'texas-alert-balance-enter', animationInfo,
    alertRegion, await press('texas-holdem-show-remain-community-card-button'), alertMasks, [], 0, 'videoFrames');
  else await gameTap(device, 'texas-holdem-show-remain-community-card-button');
  await gameReady(device, 'common-alert-button-go_to_mall');
  await capture('alert_insufficient_balance');
  if (animationInfo) await captureNativeTransition(device, 'texas-alert-balance-exit', animationInfo,
    alertRegion, await press('common-alert-button-cancel'), alertMasks, [], 0, 'videoFrames');
  else await gameTap(device, 'common-alert-button-cancel');
  await proxy.command('texas/ui', { rpcError: 'auth' });
  await texasEvents(context, [{ event: 'new_game', game_id: 'visual-fixed-game', settings: { small_blind: 1, big_blind: 2, ante: 0 } }]);
  await restoreTexas(context);
  await gameGone(device, 'texas-holdem-show-hand-card-button');
  await gameGone(device, 'texas-holdem-show-remain-community-card-button');
  if (animationInfo) await captureNativeTransition(device, 'texas-alert-auth-enter', animationInfo,
    alertRegion, await press('texas-holdem-operation-button-call'), alertMasks, [], 0, 'videoFrames');
  else await gameTap(device, 'texas-holdem-operation-button-call');
  await gameReady(device, 'common-alert-button-quit');
  expect((await gameReady(device, 'common-alert-title')).text).toMatch(/^(身份验证失败|身份驗證失敗|Authentication failed)$/);
  await capture('alert_authentication_failed');
}
