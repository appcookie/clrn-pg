import { type SignedInPageDef, BALANCE_FIXED_TEXT, NICKNAME_INPUT_FIXED_TEXT, BIO_INPUT_FIXED_TEXT } from '../../scenarioTypes';

export const pages: SignedInPageDef[] = [
  {
    label: 'signed_in_me',
    tabTestId: 'settings-tab',
    visualReadySelector: '[data-testid="settings-screen"]',
    fixedTexts: [BALANCE_FIXED_TEXT],
  },
  {
    label: 'signed_in_profile',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['user-info-button'],
    visualReadySelector: '[data-testid="profile-item-0"]',
  },
  {
    // 个人资料 → 编辑昵称表单首屏（不提交）。输入框预填当前昵称，需固定。
    label: 'signed_in_update_nickname',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['user-info-button', 'profile-item-0'],
    visualReadySelector: '[data-testid="nickname-input"]',
    fixedTexts: [NICKNAME_INPUT_FIXED_TEXT],
  },
  {
    // 个人资料 → 编辑签名表单首屏（不提交）。输入框预填当前签名，需固定。
    // profile-item-3：有用户名账号为 [昵称, 用户名, 等级, 签名]
    label: 'signed_in_update_bio',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['user-info-button', 'profile-item-3'],
    visualReadySelector: '[data-testid="bio-input"]',
    fixedTexts: [BIO_INPUT_FIXED_TEXT],
  },
  {
    label: 'signed_in_account_security',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['account-security'],
    visualReadySelector: '[data-testid="account-security-items-list"]',
  },
  {
    // 账号安全 → 绑定手机（假设视觉账号为用户名注册：无手机；不提交/不进验证码）
    label: 'signed_in_bind_phone',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['account-security', 'account-security-item-0'],
    visualReadySelector: '[data-testid="input-phone-number-container"]',
  },
  {
    // 账号安全 → 绑定邮箱（假设视觉账号无邮箱；不提交/不进验证码）
    label: 'signed_in_bind_email',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['account-security', 'account-security-item-1'],
    visualReadySelector: '[data-testid="bind-email-screen"]',
  },
  {
    // 账号安全 → 修改密码（假设视觉账号已有密码；不提交）
    label: 'signed_in_reset_password',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['account-security', 'account-security-item-2'],
    visualReadySelector: '[data-testid="old-password-input"]',
  },
  {
    // 账号安全 → 注销账号首屏（不点下一步）
    label: 'signed_in_delete_account',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['account-security', 'account-security-item-3'],
    visualReadySelector: '[data-testid="warning-sign-image"]',
  },
  {
    label: 'signed_in_user_level',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['user-level'],
    visualReadySelector: '[data-testid="user-level-screen"]',
  },
  {
    label: 'signed_in_application_management',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['application-management'],
    visualReadySelector: '[data-testid="application-management-list"]',
  },
  {
    label: 'signed_in_club_notifications',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['club-notifications'],
    visualReadySelector: '[data-testid="club-notification-screen"]',
  },
  {
    label: 'signed_in_telegram_channel',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['telegram-channel'],
    visualReadySelector: '[data-testid="channel-url-container"]',
  },
  {
    label: 'signed_in_language',
    viewports: ['mobile'],
    tabTestId: 'settings-tab',
    navClickTestIds: ['application-management', 'language'],
    visualReadySelector: '[data-testid="switch-language-container"]',
  },
];
