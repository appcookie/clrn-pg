import { type SignedInPageDef } from '../../scenarioTypes';

export const pages: SignedInPageDef[] = [
  {
    label: 'signed_in_faq',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['faq'],
    visualReadySelector: '[data-testid="faq-screen"]',
  },
  {
    // FAQ 列表 → 首条详情（分享来玩，含示意图）
    label: 'signed_in_faq_detail',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['faq', 'faq-item-share_laiwan'],
    visualReadySelector: '[data-testid="faq-detail-scroll-view"]',
  },
  {
    label: 'signed_in_contact_us',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['contact-us'],
    visualReadySelector: '[data-testid="online-service-button"]',
  },
  {
    // 联系我们 → 意见反馈（第三方 UserReport 已在 pageSetup mock 成空白页）
    label: 'signed_in_feedback',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['contact-us', 'feedback-button'],
    visualReadySelector: '[data-testid="feedback-user-report-screen"]',
    hideSelectors: ['[data-testid="loading-indicator"]'],
  },
  {
    label: 'signed_in_share_app',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['share-app'],
    visualReadySelector: '[data-testid="content-image-background"]',
  },
  {
    label: 'signed_in_official_site',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['official-site'],
    visualReadySelector: '[data-testid="application-management-list"]',
  },
  {
    label: 'signed_in_download_help',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['download-help'],
    visualReadySelector: '[data-testid="apple-button"]',
  },
  {
    label: 'signed_in_download_help_apple',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['download-help', 'apple-button'],
    visualReadySelector: '[data-testid="h5_link1_button"]',
  },
  {
    label: 'signed_in_download_help_android',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['download-help', 'android-button'],
    visualReadySelector: '[data-testid="download-android-help-view"]',
  },
  {
    label: 'signed_in_download_help_h5',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['download-help', 'h5-button'],
    visualReadySelector: '[data-testid="h5-version-help-view"]',
  },
  {
    label: 'signed_in_download_help_official',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['download-help', 'official_website-button'],
    visualReadySelector: '[data-testid="download-official-website-help-view"]',
  },
  {
    label: 'signed_in_about',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['about-laiwan'],
    // TouchableWithoutFeedback 在 Web 上会用自身 testID 覆盖子节点 Image 的 logo-image
    visualReadySelector: '[data-testid="logo-button"]',
    // 版本号随发版变化；服务器编号是测速选出的最快节点，每次运行可能不同
    fixedTexts: [
      { selector: '[data-testid="app-version-text"]', text: '0.0.0' },
      { selector: '[data-testid="latest-version-text"]', text: '0.0.0' },
      { selector: '[data-testid="current-server-text"]', text: '0' },
    ],
    // 「有新版本需要更新」提示的出现与否取决于远端版本号，本身不定
    hideSelectors: ['[data-testid="new-version-need-update-text"]'],
  },
];
