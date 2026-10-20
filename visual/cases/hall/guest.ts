import { type PageDef, type LocaleCode } from '../../scenarioTypes';

export const PAGES: PageDef[] = [
  {
    label: 'hall',
    path: '/',
    // 大厅主体；登录按钮可能在折线下，截图前再 scrollIntoView
    visualReadySelector: '[data-testid="hall-sign-in-button"]',
    readyText: {
      'zh-Hans': '登录后可查看更多牌局哦',
      'zh-Hant': '登錄後可查看更多牌局哦',
      en: 'View games after sign in',
    },
  },
];

/** 未登录大厅点击搜索，覆盖登录确认弹窗及其遮罩、文案和操作按钮。 */
export const SEARCH_SIGN_IN_PROMPT_SCENARIO = {
  pageLabel: 'search_sign_in_prompt',
  navClickTestIds: ['hall-search-button'],
  visualReadySelector: '[data-testid="confirm-pop-up-image-background"]',
};

/** 未登录大厅 → 点击德州游客场，展示登录确认弹窗。 */
export const GUEST_GAME_SIGN_IN_PROMPT_SCENARIO = {
  pageLabel: 'guest_game_sign_in_prompt',
  navClickTestIds: ['match-game-item-texas_holdem-tourists'],
  visualReadySelector: '[data-testid="game-matching-sign-in-popup"]',
  readyText: {
    'zh-Hans': '请登录后加入游戏',
    'zh-Hant': '請登入後加入遊戲',
    en: 'Please sign in to join the game',
  } as Record<LocaleCode, string>,
};
