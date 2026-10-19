import { type SignedInPageDef } from '../../scenarioTypes';

export const pages: SignedInPageDef[] = [
  {
    label: 'signed_in_message',
    tabTestId: 'message-tab',
    visualReadySelector: '[data-testid="message-screen"]',
  },
  {
    // 消息 tab → 俱乐部通知（与「我的→俱乐部通知」同屏，但入口不同）
    label: 'signed_in_message_club_notifications',
    viewports: ['mobile'],
    tabTestId: 'message-tab',
    navClickTestIds: ['message-notification-item-club'],
    visualReadySelector: '[data-testid="club-notification-screen"]',
  },
  {
    label: 'signed_in_message_buy_in',
    viewports: ['mobile'],
    tabTestId: 'message-tab',
    navClickTestIds: ['message-notification-item-buy-in'],
    visualReadySelector: '[data-testid="game-buy-in-application-list-screen"]',
  },
  {
    label: 'signed_in_message_system',
    viewports: ['mobile'],
    tabTestId: 'message-tab',
    navClickTestIds: ['message-notification-item-system'],
    visualReadySelector: '[data-testid="system-notification-screen-root"]',
  },
];
