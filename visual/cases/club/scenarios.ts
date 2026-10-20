import { type SignedInPageDef } from '../../scenarioTypes';

export const pages: SignedInPageDef[] = [
  {
    // club API mock 为空列表，ClubScreen 空态下默认已落在「我的俱乐部」tab
    label: 'signed_in_club',
    tabTestId: 'club-tab',
    visualReadySelector: '[data-testid="club-tab-screen"]',
  },
  {
    // 俱乐部 tab → 「牌局」空态（club API mock 为空列表）
    label: 'signed_in_club_rooms',
    tabTestId: 'club-tab',
    navClickTestIds: ['club_tab_room'],
    visualReadySelector: '[data-testid="club-rooms-empty-view"]',
  },
  {
    // 俱乐部 tab → 右上角更多弹层（仅打开，不点选项）
    label: 'signed_in_club_more',
    tabTestId: 'club-tab',
    navClickTestIds: ['show-more-button'],
    visualReadySelector: '[data-testid="club-more-popup"]',
  },
  {
    // 俱乐部 tab → 更多弹层 → 搜索俱乐部空态（不输入、不搜；club API mock 空列表）
    label: 'signed_in_club_search',
    tabTestId: 'club-tab',
    navClickTestIds: ['show-more-button', 'search-club-button'],
    visualReadySelector: '[data-testid="club-search-input"]',
    // hide() 后立即导航，须等弹层消失再截，避免叠层
    visualGoneSelector: '[data-testid="club-more-popup"]',
  },
  {
    label: 'signed_in_create_club',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['create-club'],
    visualReadySelector: '[data-testid="club-profile-list"]',
  },
];
