import { type SignedInPageDef, BALANCE_FIXED_TEXT } from '../../scenarioTypes';

export const pages: SignedInPageDef[] = [
  {
    label: 'signed_in_mall',
    tabTestId: 'settings-tab',
    navClickTestIds: ['mall'],
    // 外层容器会先于商品接口完成时挂载；必须等首个商品行出现，否则 reference
    // 会把只有余额卡、商品区全空的中间态写进基准图。
    visualReadySelector: '[data-testid^="product-amount-"]',
    fixedTexts: [BALANCE_FIXED_TEXT],
  },
  {
    // 商城 → 钱包流水空态（默认金币 tab）
    label: 'signed_in_currency_transaction',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['mall', 'currency-transaction-record-button'],
    visualReadySelector: '[data-testid="coin-transaction-record-view"]',
    fixedTexts: [BALANCE_FIXED_TEXT],
  },
  {
    label: 'signed_in_purchase_history',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['purchase-history'],
    visualReadySelector: '[data-testid="purchase-history-empty-view"]',
    // 列表头显示 APP_VERSION，发版即变
    fixedTexts: [{ selector: '[data-testid="purchase-history-version-text"]', text: '0.0.0' }],
  },
  {
    label: 'signed_in_game_record',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['game-record'],
    // 列表容器在首轮 API 请求开始时就已挂载；必须等空态出现，否则会把底部
    // loading-indicator 截进基准图。视觉账号约定无战绩，非空也应明确失败。
    visualReadySelector: '[data-testid="no-records-text"]',
  },
  {
    label: 'signed_in_gift_card',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['gift-card'],
    visualReadySelector: '[data-testid="personal-gift-card-screen-container"]',
  },
  {
    // 礼品卡 → 兑换表单首屏（不提交）
    label: 'signed_in_gift_card_exchange',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['gift-card', 'exchange-gift-card-button'],
    visualReadySelector: '[data-testid="gift-card-input"]',
  },
  {
    // 礼品卡 → 「已过期」tab 空态
    label: 'signed_in_gift_card_expired',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['gift-card', 'expired-gift-card-tab'],
    visualReadySelector: '[data-testid="expired-gift-card"]',
  },
];
