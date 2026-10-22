// 采集德州面板及聊天状态，入口使用即时连接与布局观测，保留真实动画和业务断言。
import { screenBounds } from './screen-geometry';
import { expect } from '@playwright/test';
import { events, REPLAY_PLAYER_IDS } from '../../visual/cases/texas-holdem/replayData';
import { flattenNodes, gameConnected, gameGone, gameNodes, gameReady, gameSemanticText, gameTap, gameTapCurrent, gameTextWithin } from './game-controls';
import { captureGameThemes, closeGameMask, gameMenu } from './game-pregame';
import { gameCardNames, replay } from './game-replay';
import { dismissKeyboard } from './keyboard';
import { gameTapText, restoreTexas, texasEvents, type TexasContext } from './texas-support';
import { animateGamePanel } from './game-panel-animation';
import { captureNativeTransition, captureTransientTransition } from './animation-transition';
import { captureBarrageMotion } from './barrage-motion';
import { nativeReviewTab } from './review-tab';
import { waitReviewCloseButton, waitReviewContent } from './review-readiness';

/**
 * 复用 Web 的二十一个面板、聊天、带入审核和手牌展示状态。
 * @param context - 当前真实房间、连接与共用顺序截图入口。
 */
export async function texasPanels(context: TexasContext): Promise<void> {
  const { device, proxy, room, self, capture, animationInfo } = context;
  await restoreTexas(context, {}, 'flop', true);
  await captureGameThemes(device, capture);
  await gameTap(device, 'game-settings-close-button');
  await gameGone(device, 'game-settings-popup-container');
  // 专用模拟器已在启动前授予麦克风权限；这里只打开界面，不录制或发送音频。
  // 首次打开完成语音组件初始化；第二次由真实按钮触发同一个入场动画。
  await gameTap(device, 'texas-holdem-voice-button');
  await gameReady(device, 'in-game-audio-microphone-button');
  await gameTap(device, 'in-game-audio-popup-close');
  await gameGone(device, 'in-game-audio-microphone-button');
  await animateGamePanel(device, 'texas-holdem', 'voice', 'texas-holdem-voice-button',
    screenBounds(device, { x: 220, y: 820, width: 280, height: 450 }), animationInfo, 'enter', 'videoFrames');
  await gameReady(device, 'in-game-audio-microphone-button');
  await capture('voice');
  await animateGamePanel(device, 'texas-holdem', 'voice', 'in-game-audio-popup-close',
    screenBounds(device, { x: 220, y: 820, width: 280, height: 450 }), animationInfo, 'exit', 'videoFrames', [],
    undefined, ['texas-holdem-voice-exit-open-phase.png']);
  await gameGone(device, 'in-game-audio-microphone-button');
  await gameTap(device, 'texas-holdem-leaderboard-button');
  await gameReady(device, 'public-leader-board-item-round-0', '10');
  await capture('leaderboard_players');
  await closeGameMask(device, 'public-leader-board-container');
  await gameTapCurrent(device, 'game-record-button');
  await waitReviewCloseButton(device);
  await waitReviewContent(device);
  const selectRecordTab = async (mode: 'settlement' | 'record') => {
    const { bounds } = nativeReviewTab(await gameNodes(device), mode);
    await device.input.tap({ x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) });
  };
  await selectRecordTab('settlement');
  /**
   * 单局牌谱默认显示第 1 页。直接检查实际页码和总页数，保留完整输入框像素。
   * 不为静态牌谱截图额外聚焦输入框：这会引入键盘位移及与牌谱无关的光标闪烁。
   * @param state - 共用牌谱截图状态。
   */
  const captureRecord = async (state: string, mode: 'settlement' | 'record') => {
    await waitReviewContent(device, mode);
    await capture(state);
  };
  await captureRecord('record_settlement', 'settlement');
  await selectRecordTab('record');
  await captureRecord('record_actions', 'record');
  await gameConnected(device);
  const close = (await waitReviewCloseButton(device))!.bounds;
  await device.input.tap({ x: Math.round(close.x + close.width / 2), y: Math.round(close.y + close.height / 2) });
  await waitReviewCloseButton(device, false);
  if (animationInfo) await captureTransientTransition(device, 'texas-system-prompt', animationInfo,
    screenBounds(device, { x: 90, y: 60, width: 540, height: 190 }),
    () => replay(proxy, 'texas', room, events([{ event: 'check_community_card', player_id: REPLAY_PLAYER_IDS[0] }])));
  const sendBarrage = () => replay(proxy, 'texas', room, { stream: 'room_message', payload: { action: 'text', content: {
    from_user_id: REPLAY_PLAYER_IDS[0], from_user_nickname: 'Player1', text: 'Good hand!',
  } } });
  if (animationInfo) await captureBarrageMotion(device, animationInfo, sendBarrage, 'Player1: Good hand!');
  else {
    await sendBarrage();
    await gameReady(device, 'barrage_text', 'Player1: Good hand!');
  }
  // 39581505067在入口准备期间重建了两条房间连接，点击后聊天未挂载。
  // 先确认持续连接就绪，再单次打开并验证面板；不重试点击或改用旧控件。
  await gameConnected(device, 2_000);
  await gameTapCurrent(device, 'texas-holdem-chat-button');
  await gameReady(device, 'in-game-chat-content-container');
  await gameTap(device, '-in-game-chat-message-tab');
  await expect.poll(async () => (await gameNodes(device)).some(node => node.res?.startsWith('in-game-chat-phrase-')),
    { timeout: 30_000 }).toBe(true);
  await gameGone(device, 'barrage_text');
  await capture('chat_phrases');
  await gameTap(device, '-in-game-chat-record-tab');
  await expect.poll(async () => gameTextWithin(await gameNodes(device), 'in-game-chat-text-message-0'),
    { timeout: 30_000 }).toContain('Player1: Good hand!');
  await capture('chat_history');
  await animateGamePanel(device, 'texas-holdem', 'chat-actions', 'in-game-chat-report-button-0',
    screenBounds(device, { x: 60, y: 800, width: 600, height: 390 }), animationInfo, 'enter', 'videoFrames');
  // The action sheet covers its originating chat message, so XCTest marks
  // in_game_report_message_component hidden while the sheet is open.
  await gameReady(device, 'report_item_report', 'Report');
  await gameReady(device, 'report_item_block', 'Block');
  await capture('chat_actions');
  await animateGamePanel(device, 'texas-holdem', 'chat-report', 'report_item_report',
    screenBounds(device, { x: 20, y: 360, width: 680, height: 560 }), animationInfo, 'enter', 'motionFrames',
    [screenBounds(device, { x: 334, y: 720, width: 110, height: 47, reason: '举报弹窗后面的房间计时独立跳秒' })]);
  await gameReady(device, 'report-popup-title');
  await dismissKeyboard(device);
  await capture('chat_report');
  await closeGameMask(device, 'report-popup-title');
  await animateGamePanel(device, 'texas-holdem', 'chat-actions-return', 'in-game-chat-report-button-0',
    screenBounds(device, { x: 60, y: 800, width: 600, height: 390 }), animationInfo);
  await animateGamePanel(device, 'texas-holdem', 'chat-block', 'report_item_block',
    screenBounds(device, { x: 20, y: 410, width: 680, height: 470 }), animationInfo, 'enter', 'motionFrames',
    [screenBounds(device, { x: 334, y: 720, width: 110, height: 47, reason: '聊天屏障后面的房间计时独立跳秒' })]);
  await gameReady(device, 'BlockPlayerConfirmPopup:title');
  await capture('chat_block_confirm');
  await animateGamePanel(device, 'texas-holdem', 'chat-block', 'BlockPlayerConfirmPopup:cancelButton',
    screenBounds(device, { x: 20, y: 410, width: 680, height: 470 }), animationInfo, 'exit', 'motionFrames',
    [screenBounds(device, { x: 334, y: 720, width: 110, height: 47, reason: '聊天屏障后面的房间计时独立跳秒' })]);
  await gameGone(device, 'BlockPlayerConfirmPopup:title');
  await closeGameMask(device, 'in-game-chat-content-container', 'in-game-chat-mask');
  const application = { stream: 'buy_in', payload: { action: 'apply_buy_in', content: {
    application_id: 'visual-application', user_id: REPLAY_PLAYER_IDS[1],
    user_nickname: 'Player2', nickname: 'Player2', amount: 500,
  } } };
  if (animationInfo) await captureNativeTransition(device, 'texas-holdem-buy-in-review-enter', animationInfo,
    screenBounds(device, { x: 70, y: 440, width: 580, height: 270 }), () => replay(proxy, 'texas', room, application),
    [], [], 0, 'videoFrames', undefined, undefined, [], [], [], [], [], undefined,
    async () => {
      // 39692518007 recorded the completed popup, then the independent
      // endpoint screenshot landed under a real Connecting... overlay.
      await gameConnected(device, 2_000);
      await gameReady(device, 'buy-in-review-close-button');
    });
  else await replay(proxy, 'texas', room, application);
  await gameReady(device, 'buy-in-review-close-button');
  await capture('buy_in_review');
  await animateGamePanel(device, 'texas-holdem', 'buy-in-review', 'buy-in-review-close-button',
    screenBounds(device, { x: 70, y: 440, width: 580, height: 270 }), animationInfo, 'exit', 'videoFrames');
  await gameGone(device, 'buy-in-review-close-button');
  // 先清除旧回合的跟注标记，避免相同牌面让恢复等待误命中上一帧。
  /** 读取本轮本人实际可见的玩家容器。 */
  const ownPlayer = async () => (await gameNodes(device)).find(node => node.res === `texas-holdem-player-container-${self}`);
  /** 跟注标记由恢复玩家资料的回调设置，可作为该回调完成的证据。 */
  const ownCalled = async () => {
    const player = await ownPlayer();
    return Boolean(player && flattenNodes(player).some(node => node.res === 'texas-holdem-player-action-call'));
  };
  await texasEvents(context, [{ event: 'new_game', game_id: 'visual-fixed-game', settings: { small_blind: 1, big_blind: 2, ante: 0 } }]);
  await expect.poll(ownCalled, { timeout: 30_000 }).toBe(false);
  await restoreTexas(context, {}, 'flop', true);
  await expect.poll(ownCalled, { timeout: 30_000 }).toBe(true);
  await expect.poll(async () => gameSemanticText(await ownPlayer(), 'text-holdem-own-balance-text'),
    { timeout: 30_000 }).toBe('1000');
  await texasEvents(context, [{ event: 'settlement', players: [{ player_id: self, net: 180, prize: 180, stack: 1180 }] }]);
  await expect.poll(async () => gameSemanticText(await ownPlayer(), 'text-holdem-own-balance-text'),
    { timeout: 30_000 }).toBe('1180');
  await gameReady(device, 'texas-holdem-show-hand-card-button');
  await gameReady(device, 'texas-holdem-show-remain-community-card-button');
  await capture('hand_end');
  await gameTap(device, 'texas-holdem-show-remain-community-card-button');
  await gameReady(device, 'view-community-cards-container');
  await gameCardNames(device, 'community_card', 'community_card_name_text', ['ah', 'kd', '7c', '2s', 'qs'], { scope: 'view-community-cards-container' });
  await capture('remaining_cards');
  await gameTap(device, 'view-community-close-button');
  await gameGone(device, 'view-community-cards-container');
  await gameTap(device, 'texas-holdem-show-hand-card-button');
  await texasEvents(context, [{ event: 'publish_hole_card', player_id: self, public_hole_card: ['as', 'ad'] }]);
  await gameReady(device, 'texas-holdem-player-hole-cards');
  await capture('show_cards');
  await texasEvents(context, [{ event: 'new_game', game_id: 'visual-fixed-game', settings: { small_blind: 1, big_blind: 2, ante: 0 } }]);
  await restoreTexas(context, {}, 'flop');
  await gameMenu(device, 'exit', 'common-alert-button-quit');
  await capture('quit_confirm');
  await gameTap(device, 'common-alert-button-cancel');
}
