import presentation from './fixtures/account-presentation.json' with { type: 'json' };

export const LANGUAGE_STORAGE_KEY = 'app.language.code.key';

// 原生场景收集不读取账号；真实登录在执行阶段验证环境配置。
export const VISUAL_DEVICE_ID = 'ios-native-visual';

export type LocaleCode = 'zh-Hans' | 'zh-Hant' | 'en';

export type LocaleDef = {
  code: LocaleCode;
  label: string;
};

export type ViewportLabel = 'desktop' | 'mobile';

export type ViewportDef = {
  label: ViewportLabel;
  width: number;
  height: number;
};

/** 截图前把易变文本替换为固定值（内容仍可读，优于隐藏遮罩） */
export type FixedTextRule = {
  selector: string;
  text: string;
};

export type PageDef = {
  label: string;
  path: string;
  /** 自定义就绪选择器：截图前等待其出现并滚动到可见 */
  visualReadySelector: string;
  readyText?: Partial<Record<LocaleCode, string>>;
};

export type VisualScenario = {
  label: string;
  /** 功能目录；用例和基准图存放在同一目录。 */
  group: ScenarioGroup;
  /** 截图场景访问路径；组件级场景可绕过常规导航。 */
  path: string;
  /** 页面标识（label 去掉 locale/viewport 前缀），冒烟过滤用 */
  pageLabel: string;
  locale: LocaleCode;
  viewport: ViewportDef;
  readyText?: string;
  visualReadySelector: string;
  /** 截图前必须完成加载的精灵图数量，避免把文本 fallback 写入基准。 */
  spriteImageCount?: number;
  /**
   * 截图前把指定滚动容器复位到顶部。用于首屏本来已包含就绪目标、但
   * scrollIntoViewIfNeeded 可能因异步布局时序留下滚动偏移的场景。
   */
  resetScrollSelector?: string;
  /**
   * 截图前等待其不可见/卸载（如选玩法 BottomSheet dismiss 动画结束）。
   * 与 visualReadySelector 配合：目标页已挂载且过渡层已消失。
   */
  visualGoneSelector?: string;
  /** true 时注入当前分片采集的登录态（失效则明确失败） */
  signIn: boolean;
  /** 独立组件级入口不挂载大厅，跳过大厅壳就绪检查。 */
  skipAppReadyCheck?: boolean;
  /** 固定 deviceId（写入 localStorage['deviceId']，所有场景统一） */
  deviceId: string;
  /** 登录后要切换的底部 tab 的 data-testid，空串表示停留在大厅 */
  tabTestId: string;
  /** 页内依次点击的 data-testid（打开登录页、进入设置子页等） */
  navClickTestIds: string[];
  waitForLoading: boolean;
  /** 截图前把易变文本替换为固定值 */
  fixedTexts: FixedTextRule[];
  /** 仅用于「出现与否本身不定」的元素（如新版本提示），display:none 摘除 */
  hideSelectors: string[];
  /** 同一业务流程连续采集的多张截图；缺省只采集 label 本身。 */
  snapshotStates?: string[];
};

export const LOCALES: LocaleDef[] = [
  { code: 'zh-Hans', label: '简中' },
  { code: 'zh-Hant', label: '繁中' },
  { code: 'en', label: 'English' },
];

export const VIEWPORTS: ViewportDef[] = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'mobile', width: 375, height: 812 },
];

/** 用户余额（金币/钻石等）随签到、购买变化，截图前统一填充固定值 */
export const BALANCE_FIXED_TEXT: FixedTextRule = {
  selector: '[data-testid$="-balance-text"]',
  text: presentation.balance,
};

/** 建房表单默认房间名取自账号昵称（CreateRoomRuleStore），随测试账号资料变化，截图前统一填充固定值 */
export const ROOM_NAME_FIXED_TEXT: FixedTextRule = {
  selector: '[data-testid="room-name-input"]',
  text: 'TestRoom',
};

/** 改昵称表单输入框预填当前昵称，随测试账号资料变化，截图前统一填充固定值 */
export const NICKNAME_INPUT_FIXED_TEXT: FixedTextRule = {
  selector: '[data-testid="nickname-input"]',
  text: 'TestNickname',
};

/** 改签名表单输入框预填当前签名，随测试账号资料变化，截图前统一填充固定值 */
export const BIO_INPUT_FIXED_TEXT: FixedTextRule = {
  selector: '[data-testid="bio-input"]',
  text: 'TestBio',
};

/**
 * 登录后（固定测试账号）要覆盖的页面。
 * tabTestId 为空表示登录后停留在大厅；其余为底部 tab 的 data-testid。
 */
export type SignedInPageDef = {
  label: string;
  tabTestId: string;
  /** 切到 tab 后依次点击的 data-testid（进入设置子页等二级页面） */
  navClickTestIds?: string[];
  visualReadySelector: string;
  /** 截图前复位到顶部的滚动容器 */
  resetScrollSelector?: string;
  /** 截图前等待其不可见/卸载（过渡弹层、BottomSheet 等） */
  visualGoneSelector?: string;
  /** 截图前把易变文本替换为固定值 */
  fixedTexts?: FixedTextRule[];
  /** 仅用于「出现与否本身不定」的元素 */
  hideSelectors?: string[];
  snapshotStates?: string[];
  /**
   * 覆盖的视口，缺省为全部。应用在 desktop 也是居中窄列布局，
   * 纯静态子页 desktop 与 mobile 只差左右留白，只保留 mobile 以省时间。
   */
  viewports?: ViewportLabel[];
};

export type ScenarioGroup = 'hall' | 'auth' | 'message' | 'private-room' | 'texas-holdem' | 'zhajinhua' | 'club' | 'account' | 'wallet' | 'game-record' | 'help';
