import { type LocaleCode } from '../../scenarioTypes';

/**
 * 登录相关页面统一走 navClickTestIds（截图前、与登录流程相同的点击原语）。
 * 注意不要改成「截图流程末尾再点击」：打开的登录 modal 会被随即卸载
 * （staging 慢时必现），排查代价极高。
 */
export const LOGIN_OPEN_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_open',
  navClickTestIds: ['hall-sign-in-button'],
  visualReadySelector: '[data-testid="sign-in-button"]',
  readyText: {
    'zh-Hans': '欢迎来到来玩',
    'zh-Hant': '歡迎來到來玩',
    en: 'Welcome to GoPlay360',
  } as Record<LocaleCode, string>,
};

/** 登录首页 → 「用户名或邮箱登录」表单页（未登录即可到达） */
export const LOGIN_USERNAME_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_username',
  navClickTestIds: ['hall-sign-in-button', 'username-or-email-sign-in-button'],
  visualReadySelector: '[data-testid="username-input"]',
};

/** 用户名登录页 → 「忘记密码」方式选择页（未登录即可到达） */
export const LOGIN_FORGOT_PASSWORD_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_forgot_password',
  navClickTestIds: [
    'hall-sign-in-button',
    'username-or-email-sign-in-button',
    'forget-password-button',
  ],
  visualReadySelector: '[data-testid="reset-password-by-email-button"]',
};

/** 忘记密码方式选择 → 邮箱重置表单首屏（未登录即可到达；不发送验证码） */
export const LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_forgot_password_email',
  navClickTestIds: [
    'hall-sign-in-button',
    'username-or-email-sign-in-button',
    'forget-password-button',
    'reset-password-by-email-button',
  ],
  visualReadySelector: '[data-testid="email-address-input"]',
};

/** 登录首页 → 手机号登录/注册表单首屏（未登录即可到达；不发送验证码） */
export const LOGIN_PHONE_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_phone',
  navClickTestIds: ['hall-sign-in-button', 'sign-in-button'],
  visualReadySelector: '[data-testid="sms-request-code-button"]',
};

/** 忘记密码方式选择 → 短信重置表单首屏（未登录即可到达；不发送验证码） */
export const LOGIN_FORGOT_PASSWORD_SMS_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_forgot_password_sms',
  navClickTestIds: [
    'hall-sign-in-button',
    'username-or-email-sign-in-button',
    'forget-password-button',
    'reset-password-by-sms-button',
  ],
  visualReadySelector: '[data-testid="next-button"]',
};

/** 手机号登录表单 → 选国家区号列表（未登录即可到达） */
export const LOGIN_PICK_COUNTRY_CODE_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_pick_country_code',
  navClickTestIds: ['hall-sign-in-button', 'sign-in-button', 'country-code-selector'],
  visualReadySelector: '[data-testid="pick-country-code-container"]',
};

/** 登录首页 → 用户协议（未登录即可到达） */
export const LOGIN_USER_AGREEMENT_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_user_agreement',
  navClickTestIds: ['hall-sign-in-button', 'user-agreement-button'],
  visualReadySelector: '[data-testid="user-agreement-screen"]',
};

/** 登录首页 → 隐私政策（未登录即可到达） */
export const LOGIN_USER_PRIVACY_SCENARIO = {
  pageLabel: 'hall',
  labelSuffix: 'login_user_privacy',
  navClickTestIds: ['hall-sign-in-button', 'user-privacy-button'],
  visualReadySelector: '[data-testid="user-privacy-screen"]',
};
