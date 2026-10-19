export * from './scenarioTypes';
import {
  PAGES,
  SEARCH_SIGN_IN_PROMPT_SCENARIO,
  GUEST_GAME_SIGN_IN_PROMPT_SCENARIO,
} from './cases/hall/guest';
import { GUEST_CLUB_SCENARIO } from './cases/club/guest';
import {
  LOGIN_OPEN_SCENARIO,
  LOGIN_USERNAME_SCENARIO,
  LOGIN_FORGOT_PASSWORD_SCENARIO,
  LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO,
  LOGIN_PHONE_SCENARIO,
  LOGIN_FORGOT_PASSWORD_SMS_SCENARIO,
  LOGIN_PICK_COUNTRY_CODE_SCENARIO,
  LOGIN_USER_AGREEMENT_SCENARIO,
  LOGIN_USER_PRIVACY_SCENARIO,
} from './cases/auth/scenarios';
export * from './cases/hall/guest';
export * from './cases/club/guest';
export * from './cases/auth/scenarios';
import {
  LOCALES,
  VIEWPORTS,
  VISUAL_DEVICE_ID,
  type LocaleCode,
  type LocaleDef,
  type PageDef,
  type ScenarioGroup,
  type SignedInPageDef,
  type ViewportDef,
  type ViewportLabel,
  type VisualScenario,
} from './scenarioTypes';
import { pages as hallPages } from './cases/hall/scenarios';
import { pages as messagePages } from './cases/message/scenarios';
import { pages as private_roomPages } from './cases/private-room/scenarios';
import { pages as texasHoldemPages } from './cases/texas-holdem/scenarios';
import { pages as zhajinhuaPages } from './cases/zhajinhua/scenarios';
import { pages as clubPages } from './cases/club/scenarios';
import { pages as accountPages } from './cases/account/scenarios';
import { pages as walletPages } from './cases/wallet/scenarios';
import { pages as gameRecordPages } from './cases/game-record/scenarios';
import { pages as helpPages } from './cases/help/scenarios';
import { getVisualSuite, selectVisualSuite } from './visual-suite';

/** push CI 核心范围（VISUAL_SCOPE=core）：核心页面，全量矩阵由 cron 覆盖 */
export const CORE_PAGE_LABELS = new Set([
  // 新增覆盖同步纳入 push CI，避免只有 reference 而未持续对比。
  'guest_message',
  'guest_me',
  'login_language',
  'login_phone_password',
  'signed_in_slot',
  'signed_in_daily_bonus',
  'signed_in_hall_search',
  'signed_in_create_room_advanced_texas',
  'signed_in_create_room_advanced_zhajinhua',
  'signed_in_create_room_advanced_six_plus',
  'signed_in_zhajinhua_pre_game',
  'signed_in_zhajinhua_game',
  'signed_in_texas_pre_game',
  'signed_in_texas_optional_pre_game',
  'signed_in_texas_game',
  'signed_in_texas_panels',
  'signed_in_texas_hall',
  'signed_in_texas_records_v2',
  'signed_in_game_records_legacy',
  'signed_in_game_records_v2',
  'signed_in_texas_controls',
  'signed_in_texas_table_states',
  'signed_in_texas_panel_variants',
  'signed_in_texas_hall_variants',
  'hall',
  'search_sign_in_prompt',
  'guest_private_room',
  'login',
  'login_username',
  'guest_club',
  'guest_game_sign_in_prompt',
  'signed_in_hall',
  'signed_in_message',
  'signed_in_private_room',
  'signed_in_club',
  'signed_in_me',
  'signed_in_mall',
]);
/**
 * 为一组页面定义统一添加场景分类。
 * @param group - 该组页面所属的场景分类。
 * @param pages - 待处理的页面定义或截图元数据清单。
 */
function withGroup(group: ScenarioGroup, pages: SignedInPageDef[]): GroupedPageDef[] {
  return pages.map(page => ({ ...page, group }));
}

type GroupedPageDef = SignedInPageDef & { group: ScenarioGroup };

/** Page definitions live beside their tests and baseline screenshots. */
export const SIGNED_IN_PAGES: GroupedPageDef[] = [
  ...withGroup('hall', hallPages),
  ...withGroup('message', messagePages),
  ...withGroup('private-room', private_roomPages),
  ...withGroup('texas-holdem', texasHoldemPages),
  ...withGroup('zhajinhua', zhajinhuaPages),
  ...withGroup('club', clubPages),
  ...withGroup('account', accountPages),
  ...withGroup('wallet', walletPages),
  ...withGroup('game-record', gameRecordPages),
  ...withGroup('help', helpPages),
];

/**
 * 解析语言筛选配置，拒绝不支持的语言代码。
 * @param raw - 原始语言筛选配置。
 */
function parseLocaleFilter(raw: string | undefined): LocaleCode[] | 'all' {
  const value = (raw || 'zh-Hans').trim();
  if (!value || value === 'all') {
    return 'all';
  }

  const allowed = new Set(LOCALES.map((locale) => locale.code));
  const selected = value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is LocaleCode => allowed.has(item as LocaleCode));

  if (selected.length === 0) {
    throw new Error(
      `VISUAL_LOCALES 无效: "${raw}"。可用值: ${LOCALES.map((l) => l.code).join(', ')}, all`,
    );
  }

  return selected;
}

/**
 * 根据环境配置选出本轮使用的语言，支持全量语言模式。
 * @param env - 环境配置，默认读取当前进程。
 */
export function getActiveLocales(env: NodeJS.ProcessEnv = process.env): LocaleDef[] {
  const filter = parseLocaleFilter(env.VISUAL_LOCALES);
  if (filter === 'all') {
    return LOCALES;
  }
  return LOCALES.filter((locale) => filter.includes(locale.code));
}

/**
 * 场景 label：`{locale}_{viewport}_{page}`，便于在目录与 HTML 报告中按「语言 → 视口」分组。
 * 例：`zh-Hans_desktop_hall`、`zh-Hans_mobile_signed_in_me`
 * @param locale - 本场景的语言配置。
 * @param viewport - 本场景的浏览器视口配置。
 * @param pageLabel - 页面定义中的场景标签。
 * @param suffix - 需要追加到场景标签的可选后缀。
 */
export function scenarioLabel(
  locale: LocaleDef,
  viewport: ViewportDef,
  pageLabel: string,
  suffix = '',
): string {
  const base = `${locale.code}_${viewport.label}_${pageLabel}`;
  return suffix ? `${base}_${suffix}` : base;
}

/**
 * 合并页面、语言、视口与覆盖选项，生成一个完整视觉场景。
 * @param page - 待展开的页面定义。
 * @param locale - 本场景的语言配置。
 * @param viewport - 本场景的浏览器视口配置。
 * @param overrides - 覆盖页面默认设置的场景选项。
 */
function buildScenario(
  page: PageDef,
  locale: LocaleDef,
  viewport: ViewportDef,
  overrides: Partial<VisualScenario> & { label?: string; pageLabel?: string } = {},
): VisualScenario {
  return {
    label: overrides.label ?? scenarioLabel(locale, viewport, page.label),
    group: 'hall',
    path: overrides.path ?? page.path,
    pageLabel: overrides.pageLabel ?? page.label,
    locale: locale.code,
    viewport,
    readyText: page.readyText?.[locale.code],
    visualReadySelector: page.visualReadySelector,
    signIn: false,
    deviceId: VISUAL_DEVICE_ID,
    tabTestId: '',
    navClickTestIds: [],
    waitForLoading: true,
    fixedTexts: [],
    hideSelectors: [],
    ...overrides,
  };
}

/**
 * 单个「语言 × 视口」下的全部页面场景（大厅 → 登录页 → 登录后 tabs）
 * @param locale - 本场景的语言配置。
 * @param viewport - 本场景的浏览器视口配置。
 */
function buildLocaleViewportScenarios(locale: LocaleDef, viewport: ViewportDef): VisualScenario[] {
  const hallPage = PAGES.find((item) => item.label === 'hall');
  if (!hallPage) {
    throw new Error('缺少 hall 页面配置');
  }

  const scenarios: VisualScenario[] = [buildScenario(hallPage, locale, viewport)];

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.pageLabel),
      pageLabel: GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.pageLabel,
      navClickTestIds: GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.navClickTestIds,
      visualReadySelector: GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.visualReadySelector,
      readyText: GUEST_GAME_SIGN_IN_PROMPT_SCENARIO.readyText[locale.code],
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, 'guest_private_room'),
      group: 'private-room',
      pageLabel: 'guest_private_room',
      tabTestId: 'private-room-tab',
      visualReadySelector: '[data-testid="guest-private-room-empty-state"]',
      readyText: undefined,
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, 'login'),
      group: 'auth',
      pageLabel: 'login',
      navClickTestIds: LOGIN_OPEN_SCENARIO.navClickTestIds,
      visualReadySelector: LOGIN_OPEN_SCENARIO.visualReadySelector,
      readyText: LOGIN_OPEN_SCENARIO.readyText[locale.code],
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, 'login_username'),
      group: 'auth',
      pageLabel: 'login_username',
      navClickTestIds: LOGIN_USERNAME_SCENARIO.navClickTestIds,
      visualReadySelector: LOGIN_USERNAME_SCENARIO.visualReadySelector,
      readyText: undefined,
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, GUEST_CLUB_SCENARIO.pageLabel),
      group: 'club',
      pageLabel: GUEST_CLUB_SCENARIO.pageLabel,
      navClickTestIds: GUEST_CLUB_SCENARIO.navClickTestIds,
      visualReadySelector: GUEST_CLUB_SCENARIO.visualReadySelector,
      readyText: undefined,
    }),
  );

  scenarios.push(
    buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, SEARCH_SIGN_IN_PROMPT_SCENARIO.pageLabel),
      pageLabel: SEARCH_SIGN_IN_PROMPT_SCENARIO.pageLabel,
      navClickTestIds: SEARCH_SIGN_IN_PROMPT_SCENARIO.navClickTestIds,
      visualReadySelector: SEARCH_SIGN_IN_PROMPT_SCENARIO.visualReadySelector,
      readyText: undefined,
    }),
  );

  // 登录支线纯静态表单/文档页，仅 mobile（desktop 只差左右留白）
  if (viewport.label === 'mobile') {
    const mobileLoginSideScenarios = [
      LOGIN_FORGOT_PASSWORD_SCENARIO,
      LOGIN_FORGOT_PASSWORD_EMAIL_SCENARIO,
      LOGIN_PHONE_SCENARIO,
      LOGIN_FORGOT_PASSWORD_SMS_SCENARIO,
      LOGIN_PICK_COUNTRY_CODE_SCENARIO,
      LOGIN_USER_AGREEMENT_SCENARIO,
      LOGIN_USER_PRIVACY_SCENARIO,
      {
        labelSuffix: 'login_language',
        navClickTestIds: ['hall-sign-in-button', 'switch-language-button'],
        visualReadySelector: '[data-testid="switch-language-container"]',
      },
      {
        labelSuffix: 'login_phone_password',
        navClickTestIds: [...LOGIN_PHONE_SCENARIO.navClickTestIds, 'password-sign-in-button'],
        visualReadySelector: '[data-testid="password-input"] input',
      },
    ];
    for (const sideScenario of mobileLoginSideScenarios) {
      scenarios.push(
        buildScenario(hallPage, locale, viewport, {
          label: scenarioLabel(locale, viewport, sideScenario.labelSuffix),
          group: 'auth',
          pageLabel: sideScenario.labelSuffix,
          navClickTestIds: sideScenario.navClickTestIds,
          visualReadySelector: sideScenario.visualReadySelector,
          readyText: undefined,
        }),
      );
    }
  }

  for (const [pageLabel, tabTestId, readyId] of [
    ['guest_message', 'message-tab', 'not-sign-in-container'],
    ['guest_me', 'settings-tab', 'after-sign-in-see-asset-text'],
  ]) {
    scenarios.push(buildScenario(hallPage, locale, viewport, {
      label: scenarioLabel(locale, viewport, pageLabel),
      group: pageLabel === 'guest_message' ? 'message' : 'account',
      pageLabel,
      tabTestId,
      visualReadySelector: `[data-testid="${readyId}"]`,
      readyText: undefined,
    }));
  }

  for (const signedInPage of SIGNED_IN_PAGES) {
    if (signedInPage.viewports && !signedInPage.viewports.includes(viewport.label)) {
      continue;
    }
    scenarios.push(
      buildScenario(hallPage, locale, viewport, {
        label: scenarioLabel(locale, viewport, signedInPage.label),
        group: signedInPage.group,
        pageLabel: signedInPage.label,
        signIn: true,
        tabTestId: signedInPage.tabTestId,
        navClickTestIds: signedInPage.navClickTestIds ?? [],
        fixedTexts: signedInPage.fixedTexts ?? [],
        hideSelectors: signedInPage.hideSelectors ?? [],
        snapshotStates: signedInPage.snapshotStates,
        visualReadySelector: signedInPage.visualReadySelector,
        resetScrollSelector: signedInPage.resetScrollSelector,
        visualGoneSelector: signedInPage.visualGoneSelector,
        // 登录后页面用选择器判定就绪，不再依赖大厅未登录文案
        readyText: undefined,
      }),
    );
  }

  return scenarios;
}

/**
 * 根据语言、范围和套件环境配置构建本轮视觉场景清单。
 * @param env - 环境配置，默认读取当前进程。
 */
export function buildScenarios(env: NodeJS.ProcessEnv = process.env): VisualScenario[] {
  const suite = getVisualSuite(env);
  const locales = getActiveLocales(env);
  const scenarios = locales.flatMap((locale) =>
    VIEWPORTS.flatMap((viewport) => buildLocaleViewportScenarios(locale, viewport)),
  );

  const scopedScenarios = env.VISUAL_SCOPE === 'core'
    ? scenarios.filter(scenario => CORE_PAGE_LABELS.has(scenario.pageLabel))
    : scenarios;
  return selectVisualSuite(scopedScenarios, suite);
}

/**
 * 指定视口下的页面数（登录支线与部分静态子页仅 mobile）
 * @param viewportLabel - 要统计的视口名称。
 */
export function pageCountForViewport(viewportLabel: ViewportLabel): number {
  // 游客主页面 9 页；登录支线 9 页仅 mobile。
  const unauthenticated = viewportLabel === 'mobile' ? 18 : 9;
  const signedIn = SIGNED_IN_PAGES.filter(
    (page) => !page.viewports || page.viewports.includes(viewportLabel),
  ).length;
  return unauthenticated + signedIn;
}

/**
 * 计算当前语言和范围配置应产生的视觉场景总数。
 * @param env - 环境配置，默认读取当前进程。
 */
export function expectedScenarioCount(env: NodeJS.ProcessEnv = process.env): number {
  return buildScenarios(env).length;
}
