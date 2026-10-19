import { type SignedInPageDef, BALANCE_FIXED_TEXT, ROOM_NAME_FIXED_TEXT } from '../../scenarioTypes';

export const pages: SignedInPageDef[] = [
  ...[
    ['texas', 'texas_react_native'],
    ['zhajinhua', 'zhajinhua'],
    ['six_plus', 'texas_six_plus'],
  ].map(([label, game]): SignedInPageDef => ({
    label: `signed_in_create_room_advanced_${label}`,
    viewports: ['mobile'],
    tabTestId: 'private-room-tab',
    navClickTestIds: ['create-game-button', `game-type-button-${game}`, 'advanced-options-button'],
    visualReadySelector: '[data-testid="operation-duration-title-text"]',
    visualGoneSelector: '[data-testid="select-game-category-text"]',
    fixedTexts: [BALANCE_FIXED_TEXT, ROOM_NAME_FIXED_TEXT],
  })),
  {
    label: 'signed_in_private_room',
    tabTestId: 'private-room-tab',
    // 私人房 Tab 直接渲染 PersonalHouseDetailScreen；房号复制入口仅会在房屋数据
    // 请求完成后的 HOUSE_DETAIL section 中出现，且位于页面顶部，适合作为首屏就绪条件。
    visualReadySelector: '[data-testid="copy-house-number-button"]',
  },
  {
    label: 'signed_in_private_room_join',
    tabTestId: 'private-room-tab',
    navClickTestIds: ['personal-house-join'],
    // 顶部房号输入框会和详情骨架屏同时出现；等房间号复制按钮才表示下方
    // 房间资料请求完成，避免把 skeleton 写进基准图。
    visualReadySelector: '[data-testid="copy-house-number-button"]',
  },
  {
    // 私人局详情（点「创建」进入；空账号显示创建游戏按钮，不提交）
    label: 'signed_in_private_room_detail',
    tabTestId: 'private-room-tab',
    navClickTestIds: ['personal-house-create'],
    // SectionList 在 skeleton 阶段也已挂载；创建按钮只在真实空房详情出现。
    visualReadySelector: '[data-testid="create-game-button"]',
    // 详情页初始化偶发自动打开选玩法弹层；详情基准不应包含该过渡态。
    visualGoneSelector: '[data-testid="select-game-category-text"]',
  },
  {
    // 详情页 → 选玩法弹层（不选具体玩法、不创建）
    label: 'signed_in_create_room_picker',
    tabTestId: 'private-room-tab',
    navClickTestIds: ['personal-house-create', 'create-game-button'],
    visualReadySelector: '[data-testid="select-game-category-text"]',
  },
  {
    // 选玩法 → 经典德州建房表单首屏（不点创建）。
    // SelectRoomGameTypePopup 选中后立即 dismiss+导航，须等弹层消失再截，避免叠层。
    label: 'signed_in_create_room_form',
    tabTestId: 'private-room-tab',
    navClickTestIds: [
      'personal-house-create',
      'create-game-button',
      'game-type-button-texas_react_native',
    ],
    visualReadySelector: '[data-testid="base-create-room-screen"]',
    visualGoneSelector: '[data-testid="select-game-category-text"]',
    // 默认房间名取自账号昵称、钻石/金币余额随账号资产变化，均需固定，避免基准图随测试账号状态漂移
    fixedTexts: [BALANCE_FIXED_TEXT, ROOM_NAME_FIXED_TEXT],
  },
  {
    // 选玩法 → 炸金花建房表单首屏（不点创建）。同德州：须等选玩法弹层消失再截。
    label: 'signed_in_create_room_form_zhajinhua',
    tabTestId: 'private-room-tab',
    navClickTestIds: ['personal-house-create', 'create-game-button', 'game-type-button-zhajinhua'],
    visualReadySelector: '[data-testid="base-create-room-screen"]',
    visualGoneSelector: '[data-testid="select-game-category-text"]',
    fixedTexts: [BALANCE_FIXED_TEXT, ROOM_NAME_FIXED_TEXT],
  },
  {
    // 选玩法 → 短牌建房表单首屏（不点创建）。同德州：须等选玩法弹层消失再截。
    label: 'signed_in_create_room_form_six_plus',
    tabTestId: 'private-room-tab',
    navClickTestIds: [
      'personal-house-create',
      'create-game-button',
      'game-type-button-texas_six_plus',
    ],
    visualReadySelector: '[data-testid="base-create-room-screen"]',
    visualGoneSelector: '[data-testid="select-game-category-text"]',
    fixedTexts: [BALANCE_FIXED_TEXT, ROOM_NAME_FIXED_TEXT],
  },
];
