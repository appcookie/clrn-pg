import { type SignedInPageDef } from '../../scenarioTypes';

export const pages: SignedInPageDef[] = [
  {
    label: 'signed_in_slot',
    tabTestId: 'hall-tab',
    navClickTestIds: ['slot-banner'],
    visualReadySelector: '[data-testid="slot-machine-view"]',
  },
  {
    label: 'signed_in_daily_bonus',
    viewports: ['mobile'],
    tabTestId: 'hall-tab',
    navClickTestIds: ['daily-bonus-button'],
    visualReadySelector: '[data-testid="CheckInDateList"]',
    // mock 使用“今天”保持已签到状态；显示日期单独固定，避免基准每天变化。
    fixedTexts: [{ selector: '[data-testid="CheckInDateListItem.checkInDetailDate"]', text: '01/01' }],
  },
  {
    label: 'signed_in_hall_search',
    tabTestId: 'hall-tab',
    navClickTestIds: ['hall-search-button'],
    visualReadySelector: '[data-testid="club-search-input"]',
  },
  {
    label: 'signed_in_hall',
    tabTestId: 'hall-tab',
    // 登录态已由 preparePage 校验。等级徽章还依赖独立接口，不能让它的波动阻塞大厅截图。
    visualReadySelector: '[data-testid="hall-shortcut-buttons-container"]',
  },
  {
    // 大厅首屏已包含德州/炸金花匹配区（不点开始匹配）。就绪目标会随远端牌局
    // 异步重排，scrollIntoViewIfNeeded 偶尔留下 129px 偏移；截图前须恢复首屏。
    // MatchTexasHoldem 独立页需浮动匹配态，不可达。
    label: 'signed_in_hall_match',
    tabTestId: 'hall-tab',
    visualReadySelector: '[data-testid="match-game-room-group"]',
    resetScrollSelector: '[data-testid="hall-content-list"]',
  },
];
