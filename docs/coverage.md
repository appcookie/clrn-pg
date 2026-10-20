# iOS 全功能迁移状态

代码位于 `ios/full/functional/`，来自下文固定 Web master 的 **60 个功能、8 个交互、3 个弱网测试**。普通业务 53 项和创建数据 7 项分开执行。所有测试都有实际原生动作与语义断言，缺配置、未知弹窗、网络错误和不可达入口会失败，没有 skip 或预期失败充当完成。

目前完成 TypeScript 检查和 Playwright 实际收集契约测试（2/2）：精确源标题与 ID、53/7 分组、8/3 清单、无跳过/预期失败。**本实现尚未执行这些原生功能案例；不将静态检查当成 iOS 业务通过。** 冒烟、全量静态图、动画及业务流程的执行证据分别记录，不能相互替代。

运行必须显式指定一个组，`all` 仅用于静态清单。每例重新安装相同 Release 包清数据，再通过真实界面登录；不会读取/构建 React 源码。每组使用 `withIosProxy(..., {visual:false})`，除明确的分页/故障夹具外保留真实后端结果。

```sh
node --test ios/full/functional/coverage.test.mjs
IOS_GROUP=functional IOS_LOCALE=en npx playwright test --config ios/full/playwright.config.ts functional
IOS_GROUP=functional-creation IOS_LOCALE=en npx playwright test --config ios/full/playwright.config.ts functional
IOS_GROUP=interaction IOS_LOCALE=en npx playwright test --config ios/full/playwright.config.ts functional
IOS_GROUP=network IOS_LOCALE=en npx playwright test --config ios/full/playwright.config.ts functional
```

`E2E_TEST_USERNAME/PASSWORD` 提供已存在的 staging 账号；创建组另需 `E2E_CREATION_USERNAME/PASSWORD` 与 `TESTING_API_TOKEN`。令牌不写入仓库、截图或 HTTP 附件。创建房间成功后立即记录精确 UUID，在 finally 删除并检查退款。新建俱乐部没有已验证删除入口，保持源测试边界，会留在 staging。

平台适配与验证边界：

- AUTH-003：原生 UI 首登，捕获真实 deviceId 后通过同一真实认证 API 再登录，再验证旧 token 401/new token 200。原生已登录页没有第二登录表单，不通过先退出或改私有缓存伪造同设备行为；这是 UI+协议组合覆盖。
- AUTH-002、PRIVATE-003、CLUB-004/005：独立真实 Simulator/UI 会话，不用 mock token；各设备必须安装本轮临时代理 CA。
- AUTH-006：读取 WKWebView 实际可访问正文，替代 iframe；容器存在不算文档已加载。
- AUTH-009/010：真实终止/重启检查持久化，替代浏览器刷新。SETTINGS-008 从英文预览简中，再取消恢复英文。
- SETTINGS-004：下载帮助是否可达按本次 iOS Release 验证，不能复用 Android default 渠道的不可达结论；缺入口明确失败，不减少清单后声称已覆盖。
- SETTINGS-010：不继承 Web 已知错误的 expected-failure，iOS 默认分类错页按正常失败处理。
- 钱包：只比较当前可见币种的首条真实流水、金额、余额、日期，合法空态不能有旧条目；固定 Simulator 时区为 UTC，日期格式使用实际接口时间。
- 分页：固定响应只匹配当前真实会话与已观测到的接口路径；验证两个请求的游标、追加条目、滚回首条和末页停止。原生虚拟列表可卸载离屏单元，不要求浏览器式保留离屏 DOM。
- 客服：iOS 原生聊天输入框编辑/清空草稿，关闭和重开；不发送消息。Web 的 script/iframe 节点数和浏览器 SDK 状态为 browser-only，不冒充 native SDK 检查；原生输入入口需实机执行确认。
- Site availability、公开 source map、CORS、localStorage/DOM/CSS、桌面重复留白是浏览器专用。原生手势/导航/系统分享分别适配，不在 iOS 跑浏览器测试冒充原生覆盖。

精确机器清单：`docs/web-coverage-source.json`，每个功能条目含 `nativeImplementation` 路径、组、源标题、适配与当前验证状态。

---

# Web → iOS 全量覆盖调查

Web master `3974319d1c72a964dad3d2c8d5862fbd255cc03b`；Android master `36112e1aadba49a83c4b36005363bfe24f94d0db`。

以下为迁移前的只读调查记录；未读取 React 应用源码。此清单不是原生测试通过证据。

## 数量

| 项 | 数量 |
|---|---:|
| functionalCaseDirectories | 42 |
| functionalDistinctTests | 60 |
| functionalMatrixTests | 120 |
| animationsDistinctTests | 21 |
| animationsMatrixTests | 41 |
| interactionsDistinctTests | 8 |
| interactionsMatrixTests | 16 |
| visualMobileFlowsPerLocale | 91 |
| visualMobileStatesPerLocale | 260 |
| visualAllLocaleViewportFlows | 402 |
| visualAllLocaleViewportStates | 1416 |

## 功能完整 60 项（精确标题、路径、断言步骤）

### 1. AUTH-001：打开用户名登录表单，密码输入被遮蔽

`e2e/cases/auth-001-login-form/test.spec.ts:4`；AUTH-001；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '从游客大厅打开用户名登录', async () => {
- '填写表单并检查密码遮蔽，不提交凭据', async () => {

### 2. AUTH-002：不同设备再次登录后旧会话失效

`e2e/cases/auth-002-session-replacement/test.spec.ts:8`；AUTH-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '设备 A 登录并验证账户接口有效', async () => {
- '不同设备 B 使用同一账号登录', async () => {
- '新会话有效，旧会话被服务器拒绝', async () => {

### 3. AUTH-003：相同设备标识再次登录的认证行为

`e2e/cases/auth-003-same-device-login/test.spec.ts:10`；AUTH-003；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '相同 deviceId 也不能保留两份有效登录凭据', async () => {

### 4. AUTH-004：手机号登录选择国家区号并切换密码方式

`e2e/cases/auth-004-phone-country-code/test.spec.ts:4`；AUTH-004；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '打开游客手机号登录表单', async () => {
- '选择中国香港区号并确认表单回填', async () => {
- '切换密码登录并确认密码遮蔽，不提交', async () => {

### 5. AUTH-005：邮箱找回密码表单可填写并返回

`e2e/cases/auth-005-password-recovery/test.spec.ts:5`；AUTH-005；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '从用户名登录进入找回密码方式选择', async () => {
- '填写找回密码联系方式，不发送验证码', async () => {
- '返回方式选择和用户名登录', async () => {

### 6. AUTH-005：短信找回密码表单可填写并返回

`e2e/cases/auth-005-password-recovery/test.spec.ts:5`；AUTH-005；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '从用户名登录进入找回密码方式选择', async () => {
- '填写找回密码联系方式，不发送验证码', async () => {
- '返回方式选择和用户名登录', async () => {

### 7. AUTH-006：user-agreement 显示可阅读正文并返回登录

`e2e/cases/auth-006-legal-documents/test.spec.ts:5`；AUTH-006；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '从登录首页打开文档', async () => {
- '确认内嵌文档加载了正文', async () => {
- '返回登录首页，仍可选择登录方式', async () => {

### 8. AUTH-006：user-privacy 显示可阅读正文并返回登录

`e2e/cases/auth-006-legal-documents/test.spec.ts:5`；AUTH-006；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '从登录首页打开文档', async () => {
- '确认内嵌文档加载了正文', async () => {
- '返回登录首页，仍可选择登录方式', async () => {

### 9. AUTH-007：测试接口创建独立账号后登录且不发放奖励

`e2e/cases/auth-007-auto-registration/test.spec.ts:9`；AUTH-007；createsData=True；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '通过测试接口创建本轮独立账号并从界面登录', async () => {
- '测试账号初始钻石为零，页面显示同一余额', async () => {
- '刷新保留同一账号，不重复注册或重复发放钻石', async () => {

### 10. AUTH-008：登录必填与密码长度校验随输入、清空即时更新

`e2e/cases/auth-008-form-validation/test.spec.ts:4`；AUTH-008；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '空表单和短密码不能提交', async () => {
- '有效输入启用提交，清空任一必填项再次禁用', async () => {

### 11. AUTH-008：找回密码拒绝空邮箱和无效格式，修改后恢复

`e2e/cases/auth-008-form-validation/test.spec.ts:30`；AUTH-008；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '空表单和短密码不能提交', async () => {
- '有效输入启用提交，清空任一必填项再次禁用', async () => {

### 12. AUTH-009：登录语言选择确认后保存，刷新仍显示对应语言

`e2e/cases/auth-009-language-persistence/test.spec.ts:4`；AUTH-009；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- `切换 ${locale.label}，检查保存和刷新后的界面`, async () => {

### 13. AUTH-010：退出可取消，确认后刷新仍为游客且受保护入口要求登录

`e2e/cases/auth-010-sign-out/test.spec.ts:5`；AUTH-010；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '取消退出保留当前账号', async () => {
- '确认退出后资产和账号入口恢复游客状态', async () => {
- '重新加载后不会自动恢复登录，私人房间入口仍受保护', async () => {

### 14. AUTH-011：用户名规范化、最短长度和密码上限

`e2e/cases/auth-011-username-password-boundaries/test.spec.ts:5`；AUTH-011；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '用户名去除两端空格并转换小写', async () => {
- '五位用户名无效，六位用户名有效', async () => {
- '十九位密码有效，二十位密码无效', async () => {

### 15. 真实创建俱乐部并核实详情、归属和服务端持久化

`e2e/cases/club-001-create/test.spec.ts:6`；CLUB-001；createsData=True；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '进入创建表单，验证必填校验与50钻费用', async () => {
- '提交真实创建，验证详情与50钻扣除', async () => {
- '独立读取刚创建的俱乐部，验证服务端持久化与创建人归属', async () => {

### 16. 真实创建俱乐部德州牌局、验证归属并通过API清理退款

`e2e/cases/club-002-create-and-dismiss-game/test.spec.ts:6`；CLUB-002；createsData=True；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '创建本用例自己的俱乐部，避免依赖其他测试顺序', async () => {
- '从俱乐部详情选择德州，确认默认10钻创建配置', async () => {
- '真实创建，验证服务端俱乐部归属、牌桌名称、等待开始及扣钻', async () => {
- '通过API只清理本次精确UUID的未开始牌局，验证10钻退款', async () => {

### 17. 俱乐部切换列表、真实搜索无匹配名称并返回

`e2e/cases/club-003-search-and-navigation/test.spec.ts:5`；CLUB-003；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '切换我的俱乐部与牌局列表', async () => {
- '从更多菜单打开搜索，并验证真实无匹配结果', async () => {
- '返回俱乐部列表和大厅', async () => {

### 18. CLUB-004：房主连续移除成员后人数与列表一致

`e2e/cases/club-004-member-management/test.spec.ts:15`；CLUB-004；createsData=True；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '创建本例专用俱乐部并核对真实扣费', async () => {
- '两个独立账号经真实申请和审批成为成员', async () => {
- '连续删除与中途取消编辑后，页面和服务端人数一致', async () => {

### 19. 普通申请、邀请申请经房主审批后才成为俱乐部成员

`e2e/cases/club-005-join-approval-invite/test.spec.ts:7`；CLUB-005；createsData=True；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '房主创建独立俱乐部，核对初始成员和费用', async () => {
- '申请人通过真实搜索找到本次俱乐部并提交加入申请', async () => {
- '房主在申请列表审批，申请人成为真实成员', async () => {
- '邀请链接生成、解析后受邀者提交真实申请', async () => {
- '房主审批受邀者，成员列表和人数体现实际加入', async () => {
- '另一申请被房主拒绝后仍不是成员', async () => {

### 20. CLUB-006：纯空格地区和清空名称禁用完成

`e2e/cases/club-006-create-form-boundaries/test.spec.ts:6`；CLUB-006；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '有效表单改为纯空格地区后禁用，再恢复', async () => {
- '清空名称后禁用，取消返回我的页面', async () => {

### 21. HALL-001：游客进入私人房间后返回大厅

`e2e/cases/hall-001-guest-navigation/test.spec.ts:4`；HALL-001；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '准备简体中文游客大厅', async () => {
- '进入私人房间并检查游客空态', async () => {
- '返回大厅，仍可使用登录入口', async () => {

### 22. HALL-002：游客 club-tab 空态可进入登录

`e2e/cases/hall-002-guest-sign-in-gates/test.spec.ts:5`；HALL-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '打开游客功能入口', async () => {
- '点击游客引导并验证登录选项', async () => {
- '打开我的页面并检查游客资产提示', async () => {
- '打开登录方式选择', async () => {
- '打开搜索登录门禁', async () => {
- '取消后保持游客状态', async () => {
- '再次搜索并确认登录', async () => {
- '等待场次数据并打开游客场', async () => {
- '关闭弹窗，保持游客大厅', async () => {

### 23. HALL-002：游客 message-tab 空态可进入登录

`e2e/cases/hall-002-guest-sign-in-gates/test.spec.ts:5`；HALL-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '打开游客功能入口', async () => {
- '点击游客引导并验证登录选项', async () => {
- '打开我的页面并检查游客资产提示', async () => {
- '打开登录方式选择', async () => {
- '打开搜索登录门禁', async () => {
- '取消后保持游客状态', async () => {
- '再次搜索并确认登录', async () => {
- '等待场次数据并打开游客场', async () => {
- '关闭弹窗，保持游客大厅', async () => {

### 24. HALL-002：游客我的页面隐藏资产并提供登录入口

`e2e/cases/hall-002-guest-sign-in-gates/test.spec.ts:19`；HALL-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '打开游客功能入口', async () => {
- '点击游客引导并验证登录选项', async () => {
- '打开我的页面并检查游客资产提示', async () => {
- '打开登录方式选择', async () => {
- '打开搜索登录门禁', async () => {
- '取消后保持游客状态', async () => {
- '再次搜索并确认登录', async () => {
- '等待场次数据并打开游客场', async () => {
- '关闭弹窗，保持游客大厅', async () => {

### 25. HALL-002：游客搜索提示可取消，也可前往登录

`e2e/cases/hall-002-guest-sign-in-gates/test.spec.ts:32`；HALL-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '打开游客功能入口', async () => {
- '点击游客引导并验证登录选项', async () => {
- '打开我的页面并检查游客资产提示', async () => {
- '打开登录方式选择', async () => {
- '打开搜索登录门禁', async () => {
- '取消后保持游客状态', async () => {
- '再次搜索并确认登录', async () => {
- '等待场次数据并打开游客场', async () => {
- '关闭弹窗，保持游客大厅', async () => {

### 26. HALL-002：游客 texas_holdem 入场需登录且可关闭

`e2e/cases/hall-002-guest-sign-in-gates/test.spec.ts:52`；HALL-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '打开游客功能入口', async () => {
- '点击游客引导并验证登录选项', async () => {
- '打开我的页面并检查游客资产提示', async () => {
- '打开登录方式选择', async () => {
- '打开搜索登录门禁', async () => {
- '取消后保持游客状态', async () => {
- '再次搜索并确认登录', async () => {
- '等待场次数据并打开游客场', async () => {
- '关闭弹窗，保持游客大厅', async () => {

### 27. HALL-002：游客 zhajinhua 入场需登录且可关闭

`e2e/cases/hall-002-guest-sign-in-gates/test.spec.ts:52`；HALL-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '打开游客功能入口', async () => {
- '点击游客引导并验证登录选项', async () => {
- '打开我的页面并检查游客资产提示', async () => {
- '打开登录方式选择', async () => {
- '打开搜索登录门禁', async () => {
- '取消后保持游客状态', async () => {
- '再次搜索并确认登录', async () => {
- '等待场次数据并打开游客场', async () => {
- '关闭弹窗，保持游客大厅', async () => {

### 28. HALL-003：大厅搜索同时查询俱乐部和私人房间并返回

`e2e/cases/hall-003-signed-in-shortcuts/test.spec.ts:4`；HALL-003；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '打开已登录大厅搜索', async () => {
- '提交不存在的九位号码并验证联合查询空结果', async () => {
- '返回大厅并保持登录状态', async () => {
- '从消息通知进入三类消息列表再返回大厅', async () => {
- '从商店进入真实钻石商品列表再返回', async () => {
- '打开邀请页面，核对下载和 H5 地址再返回', async () => {
- '打开每日奖励并检查七天奖励内容', async () => {
- '查看说明并返回，不领取签到或救济金', async () => {

### 29. HALL-003：通知、商城和邀请快捷入口可往返

`e2e/cases/hall-003-signed-in-shortcuts/test.spec.ts:41`；HALL-003；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '打开已登录大厅搜索', async () => {
- '提交不存在的九位号码并验证联合查询空结果', async () => {
- '返回大厅并保持登录状态', async () => {
- '从消息通知进入三类消息列表再返回大厅', async () => {
- '从商店进入真实钻石商品列表再返回', async () => {
- '打开邀请页面，核对下载和 H5 地址再返回', async () => {
- '打开每日奖励并检查七天奖励内容', async () => {
- '查看说明并返回，不领取签到或救济金', async () => {

### 30. HALL-003：每日奖励展示七日签到和救济规则，浏览后返回

`e2e/cases/hall-003-signed-in-shortcuts/test.spec.ts:69`；HALL-003；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '打开已登录大厅搜索', async () => {
- '提交不存在的九位号码并验证联合查询空结果', async () => {
- '返回大厅并保持登录状态', async () => {
- '从消息通知进入三类消息列表再返回大厅', async () => {
- '从商店进入真实钻石商品列表再返回', async () => {
- '打开邀请页面，核对下载和 H5 地址再返回', async () => {
- '打开每日奖励并检查七天奖励内容', async () => {
- '查看说明并返回，不领取签到或救济金', async () => {

### 31. HALL-004：游客 slot-banner 登录引导关闭后可返回大厅

`e2e/cases/hall-004-guest-shortcuts/test.spec.ts:5`；HALL-004；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '进入受保护业务并检查登录入口', async () => {
- '关闭登录后保持游客状态，入口可再次使用', async () => {

### 32. HALL-004：游客 daily-bonus-button 登录引导关闭后可返回大厅

`e2e/cases/hall-004-guest-shortcuts/test.spec.ts:5`；HALL-004；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '进入受保护业务并检查登录入口', async () => {
- '关闭登录后保持游客状态，入口可再次使用', async () => {

### 33. HALL-004：游客 store-button 登录引导关闭后可返回大厅

`e2e/cases/hall-004-guest-shortcuts/test.spec.ts:5`；HALL-004；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '进入受保护业务并检查登录入口', async () => {
- '关闭登录后保持游客状态，入口可再次使用', async () => {

### 34. HALL-004：游客 personal-house-create 登录引导关闭后可返回大厅

`e2e/cases/hall-004-guest-shortcuts/test.spec.ts:5`；HALL-004；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '进入受保护业务并检查登录入口', async () => {
- '关闭登录后保持游客状态，入口可再次使用', async () => {

### 35. HALL-004：游客 personal-house-join 登录引导关闭后可返回大厅

`e2e/cases/hall-004-guest-shortcuts/test.spec.ts:5`；HALL-004；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '进入受保护业务并检查登录入口', async () => {
- '关闭登录后保持游客状态，入口可再次使用', async () => {

### 36. HALL-005：清空无结果搜索恢复默认引导

`e2e/cases/hall-005-search-clear-state/test.spec.ts:6`；HALL-005；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '提交唯一关键字，真实搜索返回后显示结果空态', async () => {
- '清空关键字后移除结果空态，恢复初始引导', async () => {

### 37. MESSAGE-001：浏览三类消息并返回消息列表

`e2e/cases/message-001-notification-navigation/test.spec.ts:5`；MESSAGE-001；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '登录并打开消息列表', async () => {
- `打开${label}、确认空态并返回`, async () => {
- '从我的再次进入俱乐部消息并返回', async () => {

### 38. MESSAGE-002：带入通知切换未处理和已处理状态

`e2e/cases/message-002-buy-in-tabs/test.spec.ts:6`；MESSAGE-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '初始未处理选中，切至已处理后两者状态互斥', async () => {
- '切回未处理并返回消息分类列表', async () => {

### 39. 私人德州牌局真实创建、退出、解散并退回钻石

`e2e/cases/private-001-create-and-dismiss/test.spec.ts:6`；PRIVATE-001；createsData=True；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '进入空私人房间，检查创建配置和实际资产', async () => {
- '提交真实创建，验证桌名、房型、等待开始及扣钻', async () => {
- '退出桌面，验证刚创建牌局仍在私人房间', async () => {
- '清理本次未开始牌局，验证真实解散接口和退款', async () => {

### 40. 经典德州配置可编辑、展开高级设置并返回

`e2e/cases/private-002-game-configuration/test.spec.ts:10`；PRIVATE-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '从私人房间选择玩法', async () => {
- '验证玩法配置并展开高级设置', async () => {
- '返回私人房间，不创建牌局或消耗钻石', async () => {

### 41. 拼三张配置可编辑、展开高级设置并返回

`e2e/cases/private-002-game-configuration/test.spec.ts:10`；PRIVATE-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '从私人房间选择玩法', async () => {
- '验证玩法配置并展开高级设置', async () => {
- '返回私人房间，不创建牌局或消耗钻石', async () => {

### 42. 短牌配置可编辑、展开高级设置并返回

`e2e/cases/private-002-game-configuration/test.spec.ts:10`；PRIVATE-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '从私人房间选择玩法', async () => {
- '验证玩法配置并展开高级设置', async () => {
- '返回私人房间，不创建牌局或消耗钻石', async () => {

### 43. 第二账号通过真实房号加入新建私人牌局

`e2e/cases/private-003-join-created-room/test.spec.ts:7`；PRIVATE-003；createsData=True；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '房主创建等待开始的私人牌局并读取其真实房号', async () => {
- '加入者输入房主的九位房号，实际进入同一牌桌', async () => {

### 44. PRIVATE-004：九位数字房号才启用加入，字母输入被拒绝

`e2e/cases/private-004-room-number-validation/test.spec.ts:6`；PRIVATE-004；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '空房号和八位房号禁用加入，九位启用', async () => {
- '真实按键清空，输入字母后仍为空且禁用加入', async () => {

### 45. PRIVATE-005：德州扑克带入审核切换后恢复初始值

`e2e/cases/private-005-buy-in-audit-toggle/test.spec.ts:11`；PRIVATE-005；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '从私人房选择玩法，等待建房表单和弹层关闭', async () => {
- '审核开关切换为反值，再恢复进入页面时的值', async () => {
- '取消返回，不创建牌局', async () => {

### 46. PRIVATE-005：拼三张带入审核切换后恢复初始值

`e2e/cases/private-005-buy-in-audit-toggle/test.spec.ts:11`；PRIVATE-005；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '从私人房选择玩法，等待建房表单和弹层关闭', async () => {
- '审核开关切换为反值，再恢复进入页面时的值', async () => {
- '取消返回，不创建牌局', async () => {

### 47. PRIVATE-005：德州短牌带入审核切换后恢复初始值

`e2e/cases/private-005-buy-in-audit-toggle/test.spec.ts:11`；PRIVATE-005；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '从私人房选择玩法，等待建房表单和弹层关闭', async () => {
- '审核开关切换为反值，再恢复进入页面时的值', async () => {
- '取消返回，不创建牌局', async () => {

### 48. SETTINGS-001：个人资料预填、取消编辑与等级浏览

`e2e/cases/settings-001-profile-browsing/test.spec.ts:5`；SETTINGS-001；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '登录并检查我的资料和余额', async () => {
- '昵称预填当前资料，取消编辑后资料不变', async () => {
- '签名输入后取消，重新打开仍为原值', async () => {
- '返回我的并浏览等级说明及奖励', async () => {

### 49. SETTINGS-002：浏览账号安全四个分支并安全返回

`e2e/cases/settings-002-account-security/test.spec.ts:5`；SETTINGS-002；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '登录并进入账号与安全', async () => {
- '浏览绑定手机，确认区号和空表单后返回', async () => {
- '浏览绑定邮箱说明后返回', async () => {
- '浏览改密空表单后返回', async () => {
- '阅读注销影响并选择暂不注销', async () => {

### 50. SETTINGS-003：商城商品、钱包流水、购买记录和礼品卡浏览

`e2e/cases/settings-003-wallet-records/test.spec.ts:5`；SETTINGS-003；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '登录并打开商城，等待真实商品加载', async () => {
- '金币和钻石流水与真实接口一致，兼容没有注册奖励的账号', async () => {
- '打开购买记录，确认空态并返回', async () => {
- '切换可用和过期礼品卡，打开兑换表单后返回', async () => {

### 51. SETTINGS-004：客服、常见问题与各平台下载帮助浏览

`e2e/cases/settings-004-help-download/test.spec.ts:21`；SETTINGS-004；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '登录并打开我的', async () => {
- '从联系客服进入常见问题，并查看分享图文说明', async () => {
- '浏览苹果下载帮助后返回平台列表', async () => {
- `浏览${button}说明并返回`, async () => {

### 52. SETTINGS-005：语言偏好、关于、官网与分享入口浏览

`e2e/cases/settings-005-preferences-about/test.spec.ts:5`；SETTINGS-005；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '登录并打开我的', async () => {
- '语言列表展示当前选中项，返回后保留简体中文', async () => {
- '关于显示实际版本和协议入口', async () => {
- '官网列表展示三个 HTTPS 地址', async () => {
- '分享页展示下载地址和扫码说明', async () => {
- '频道入口展示官方频道 URL', async () => {

### 53. SETTINGS-006：我的战绩加载为空态并返回个人设置

`e2e/cases/settings-006-game-record/test.spec.ts:5`；SETTINGS-006；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '登录并从我的进入战绩', async () => {
- '等待接口完成并确认无战绩', async () => {
- '通过导航返回我的', async () => {

### 54. SETTINGS-007：修改密码的八至十六位边界

`e2e/cases/settings-007-password-boundaries/test.spec.ts:7`；SETTINGS-007；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '旧密码有效时验证新密码的七、八、十六、十七位', async () => {
- '新密码有效时验证旧密码边界和清空状态', async () => {
- '返回账号安全，不提交修改密码请求', async () => {

### 55. SETTINGS-008：语言预览后取消恢复已保存语言

`e2e/cases/settings-008-language-cancel/test.spec.ts:6`；SETTINGS-008；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '选择英文后立即显示英文预览和选中标记', async () => {
- '返回取消，再次打开仍选中简中且显示中文', async () => {

### 56. SETTINGS-009：文字 FAQ 的标题、正文与返回

`e2e/cases/settings-009-text-faq/test.spec.ts:6`；SETTINGS-009；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '答案标题对应问题，文字正文非空', async () => {
- '返回问题列表，原问题保持不变', async () => {

### 57. SETTINGS-010：金币余额入口保留真实余额并默认显示金币

`e2e/cases/settings-010-coin-mall-entry/test.spec.ts:5`；SETTINGS-010；createsData=False；knownExpectedFailure=True。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '等待真实钱包响应并核对我的金币余额', async () => {
- '点击金币余额，商城保持余额且默认展示金币分类', async () => {

### 58. SETTINGS-011：金币与钻石分类往返显示对应商品

`e2e/cases/settings-011-mall-categories/test.spec.ts:5`；SETTINGS-011；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '选择金币，金币商品进入视口且钻石列表离开视口', async () => {
- '选择钻石，真实价格可见且金币页离开视口', async () => {
- '再次选择金币，金币页重新进入视口', async () => {

### 59. SETTINGS-012：钱包流水切换请求对应币种并恢复金币页

`e2e/cases/settings-012-wallet-currencies/test.spec.ts:6`；SETTINGS-012；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- '打开金币流水，真实接口成功且金币页进入视口', async () => {
- '切换钻石，真实接口成功并展示钻石页', async () => {
- '切回金币，金币流水重新进入视口', async () => {

### 60. SLOT-001：抽奖面板显示能量和奖品，关闭重开不消耗钻石

`e2e/cases/slot-001-panel-navigation/test.spec.ts:5`；SLOT-001；createsData=False；knownExpectedFailure=False。

Navigation and visual state overlap; full functional assertion parity is NOT established by native Android screenshots.

- `第 ${visit + 1} 次打开和关闭抽奖面板`, async () => {

## 动画完整 21 项 / 双视口41实例

- **launch branding fades in** — `visual/animations/ambient.spec.ts:8`。Projects=mobile, desktop。Android fixed package launch notice obscures branding fade; only visible artwork/notice covered.
- **hall slot banner automatically spins and repeats** — `visual/animations/ambient.spec.ts:27`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **guest search confirmation enter and exit** — `visual/animations/application.spec.ts:8`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **club more menu enter and exit** — `visual/animations/application.spec.ts:20`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **private room invitation bottom sheet enter and exit** — `visual/animations/application.spec.ts:29`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **create room game picker enter and exit** — `visual/animations/application.spec.ts:41`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **club rooms empty state fades in** — `visual/animations/application.spec.ts:52`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **hall matching spinner modal enter and exit** — `visual/animations/application.spec.ts:63`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **staging notice fades and scales in on launch** — `visual/animations/dialogs.spec.ts:9`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **share link confirmation dialog enter and exit** — `visual/animations/dialogs.spec.ts:35`。Projects=mobile, desktop。Web-only .web.js dialog; Android uses OS share sheet.
- **zh-Hans mobile guest search prompt fades in** — `visual/animations/search-prompt.spec.ts:27`。Projects=mobile。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **club list placeholders pulse while details are pending** — `visual/animations/skeleton.spec.ts:5`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **slot reels and all three reward animations** — `visual/animations/slot.spec.ts:6`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **slot panel and no-energy dialog enter and exit** — `visual/animations/slotPopups.spec.ts:7`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **texas panels animations** — `visual/animations/texas.spec.ts:19`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **texas gameplay animations** — `visual/animations/texas.spec.ts:19`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **texas social animations** — `visual/animations/texas.spec.ts:19`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **texas assets animations** — `visual/animations/texas.spec.ts:19`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **texas hall panel animations** — `visual/animations/texas.spec.ts:27`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **zhajinhua panels animations** — `visual/animations/zhajinhua.spec.ts:7`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.
- **zhajinhua gameplay animations** — `visual/animations/zhajinhua.spec.ts:7`。Projects=mobile, desktop。Native analogue in android/ANIMATION_COVERAGE.md; exact native trigger and frames need adaptation.

## 交互完整8项

- **在线客服打开真实 Freshchat，可输入草稿、关闭并再次打开** — `e2e/interactions/freshchat.spec.ts:21`。
- **横向手势切换申请标签，触底按游标追加且末页停止请求** — `e2e/interactions/pagination.spec.ts:30`。
- **大厅滚动后可返回顶部并打开搜索** — `e2e/interactions/scroll-and-controls.spec.ts:4`。
- **选择玩法弹层关闭后仍能打开建房表单并拖动滑块** — `e2e/interactions/scroll-and-controls.spec.ts:40`。
- **俱乐部请求失败后点击重试恢复列表并可打开菜单** — `e2e/interactions/scroll-and-controls.spec.ts:91`。
- **大厅接口失败后点击重试恢复页面操作** — `e2e/interactions/scroll-and-controls.spec.ts:148`。
- **我的虚拟列表可滚动到后续菜单并进入关于页面** — `e2e/interactions/settings-scroll.spec.ts:4`。
- **我的列表最后一项可通过真实滚动进入视口** — `e2e/interactions/settings-scroll.spec.ts:26`。

## 额外 E2E 与 browser-only

[
  {
    "path": "e2e/network-resilience.spec.ts",
    "browserOnly": false,
    "titles": [
      "大厅首屏超时显示提示，重试后恢复真实牌局列表",
      "用户名登录接口失败后退出 loading 并显示错误提示",
      "俱乐部列表接口失败时展示降级界面并允许重试"
    ]
  },
  {
    "path": "e2e/staging-notice.spec.ts",
    "browserOnly": false,
    "description": "Three languages: correct confirmation text mandatory before hall"
  },
  {
    "path": "e2e/sites-availability.spec.ts",
    "browserOnly": true
  },
  {
    "path": "e2e/public-artifacts.spec.ts",
    "browserOnly": true
  },
  {
    "path": "e2e/mitmproxy.spec.ts",
    "browserOnly": true,
    "description": "test infrastructure; port proxy facility assertions separately"
  }
]

## 视觉完整91移动流程/260状态

- `hall` [hall]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `guest_game_sign_in_prompt` [hall]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `guest_private_room` [private-room]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `login` [auth]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `login_username` [auth]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `guest_club` [club]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `search_sign_in_prompt` [hall]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `login_forgot_password` [auth]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `login_forgot_password_email` [auth]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `login_phone` [auth]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `login_forgot_password_sms` [auth]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `login_pick_country_code` [auth]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `login_user_agreement` [auth]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `login_user_privacy` [auth]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `login_language` [auth]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `login_phone_password` [auth]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `guest_message` [message]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `guest_me` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_slot` [hall]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_daily_bonus` [hall]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_hall_search` [hall]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_hall` [hall]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_hall_match` [hall]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_message` [message]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_message_club_notifications` [message]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_message_buy_in` [message]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_message_system` [message]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_create_room_advanced_texas` [private-room]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_create_room_advanced_zhajinhua` [private-room]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_create_room_advanced_six_plus` [private-room]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_private_room` [private-room]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_private_room_join` [private-room]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_private_room_detail` [private-room]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_create_room_picker` [private-room]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_create_room_form` [private-room]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_create_room_form_zhajinhua` [private-room]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_create_room_form_six_plus` [private-room]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_texas_pre_game` [texas-holdem]：waiting_table, menu, card_rank, theme, settings, buy_in, renew, leaderboard, game_record, chat, buy_in_applications。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_texas_optional_pre_game` [texas-holdem]：waiting_table, raise_blinds。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_texas_game` [texas-holdem]：preflop, flop, turn, river, raise, accurate_raise, opponent_turn, all_in, showdown, settlement, own_profile, player_profile, player_statistics_1000, statistics_help, report, block。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_texas_panels` [texas-holdem]：theme_four_color, theme_four_color_two, theme_realistic, table_blue, table_purple, table_black, settings_enabled, voice, leaderboard_players, record_settlement, record_actions, chat_phrases, chat_history, chat_actions, chat_report, chat_block_confirm, buy_in_review, hand_end, remaining_cards, show_cards, quit_confirm。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_texas_hall` [texas-holdem]：hall_table, hall_menu, auto_rebuy, pair_play_report, personal_leaderboard, prediction, prediction_result, level_up。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_texas_records_v2` [texas-holdem]：empty, actions, settlement。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_texas_controls` [texas-holdem]：check, all_in_only, all_in_call, shortcut_blinds, shortcut_disabled, auto_buttons, auto_fold_selected, auto_call_selected, auto_check_selected, raise_maximum, raise_dragging, accurate_raise_value, accurate_raise_minimum_error。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_texas_table_states` [texas-holdem]：observer, full_table, full_table_multiple_pots, reserved_seat, player_disconnected, guest_menu。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_texas_panel_variants` [texas-holdem]：applications_pending, applications_resolved, applications_more, chat_audio_history, chat_barrage_off, alert_retry, alert_insufficient_balance, alert_authentication_failed。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_texas_hall_variants` [texas-holdem]：auto_rebuy_enabled, pair_play_selected, prediction_bet, prediction_loss, prediction_diamond, delay_cooldown, delay_cooldown_alert。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_zhajinhua_pre_game` [zhajinhua]：waiting_table, menu, card_rank, theme, settings, buy_in, renew, leaderboard, game_record, chat, buy_in_applications, theme_four_color, theme_four_color_two, theme_realistic, table_blue, table_purple, table_black, settings_enabled。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_zhajinhua_game` [zhajinhua]：blind_cards, seen_cards, quick_raise, accurate_raise, challenge_select, opponent_turn, showdown, settlement。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_club` [club]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_club_rooms` [club]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_club_more` [club]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_club_search` [club]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_create_club` [club]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_me` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_profile` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_update_nickname` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_update_bio` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_account_security` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_bind_phone` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_bind_email` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_reset_password` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_delete_account` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_user_level` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_application_management` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_club_notifications` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_telegram_channel` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_language` [account]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_mall` [wallet]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_currency_transaction` [wallet]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_purchase_history` [wallet]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_game_record` [wallet]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_gift_card` [wallet]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_gift_card_exchange` [wallet]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_gift_card_expired` [wallet]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_game_records_legacy` [game-record]：loading, empty, list, list_bottom, select_none, select_win, select_loss, select_all, select_clear, select_cancel, swipe_delete, delete_confirm, delete_cancel, delete_blocked, private_overview, private_relationship, private_relationship_switch, private_actions, private_settlement, replay_list, club_overview, club_actions, club_settlement, hall_overview, short_deck_overview, no_hands, replay_empty, delete_success, delete_failure, pagination_loading, pagination_end, reopen。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_game_records_v2` [game-record]：loading, empty, list, list_bottom, select_none, select_win, select_loss, select_all, select_clear, select_cancel, swipe_delete, delete_confirm, delete_cancel, delete_blocked, private_overview, private_relationship, private_relationship_switch, private_actions, private_settlement, replay_list, club_overview, club_actions, club_settlement, hall_overview, short_deck_overview, no_hands, replay_empty, list_failure, retry_success, detail_failure。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_faq` [help]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_faq_detail` [help]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_contact_us` [help]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_feedback` [help]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_share_app` [help]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_official_site` [help]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `signed_in_download_help` [help]：单张。Unavailable in Android default distribution channel; verify iOS package channel.
- `signed_in_download_help_apple` [help]：单张。Unavailable in Android default distribution channel; verify iOS package channel.
- `signed_in_download_help_android` [help]：单张。Unavailable in Android default distribution channel; verify iOS package channel.
- `signed_in_download_help_h5` [help]：单张。Unavailable in Android default distribution channel; verify iOS package channel.
- `signed_in_download_help_official` [help]：单张。Unavailable in Android default distribution channel; verify iOS package channel.
- `signed_in_about` [help]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `launch_staging_notice` [launch]：单张。Shared mobile visual flow; game/record suites adapted separately.
- `launch_branding` [launch]：单张。Shared mobile visual flow; game/record suites adapted separately.

## 账号与后端依赖

- **existing**: E2E_TEST_USERNAME; E2E_TEST_PASSWORD; real staging session/account/wallet checks; no missing-account registration
- **creation**: TESTING_API_TOKEN; E2E_CREATION_USERNAME; E2E_CREATION_PASSWORD; starting 60 diamond; club cost50 + room cost10
- **registration**: POST /public/v10/user/register/username_password/testing; X-Testing-Api-Token; zero initial diamonds; no retries
- **multipleAccounts**: AUTH-002/003; PRIVATE-003; CLUB-004; CLUB-005
- **cleanup**: exact created room UUID cleanup/refund; created clubs have no verified delete path, remain staging
- **CI**: CLRN_CI_TEST_ACCOUNTS_V3; same-user jobs serialized
- **privacy**: do not upload tokens/request bodies or sensitive login DOM

## 可迁移 helper

- `e2e/cases/_shared/auth.ts`
- `e2e/cases/_shared/provision.ts`
- `e2e/cases/_shared/test-user.ts`
- `e2e/cases/_shared/test-wallet.ts`
- `e2e/cases/_shared/read-account-fixture.ts`
- `e2e/cases/_shared/creation-account-fixture.ts`
- `e2e/cases/_shared/second-account.ts`
- `e2e/cases/_shared/sign-in-notices.ts`
- `e2e/cases/_shared/form.ts`
- `e2e/cases/_shared/navigation.ts`
- `e2e/cases/_shared/settings-navigation.ts`
- `e2e/mitmproxy/network_faults.py`
- `e2e/mitmproxy/response_overrides.py`
- `visual/cases/texas-holdem/mitmproxy/texas_replay.py`
- `visual/cases/texas-holdem/mitmproxy/ui_states.py`
- `visual/cases/texas-holdem/mitmproxy/records_v2.py`
- `visual/cases/zhajinhua/mitmproxy/zhajinhua_replay.py`
- `visual/cases/game-record/mitmproxy/addon.py`
- `visual/cases/game-record/mitmproxy/data.py`

## 覆盖判定与平台边界

- Only test repository source read; no React application source or repository mutation. --list does not execute tests.
- Local functional/scenario definitions equal fetched master; master-only diagnostics changes do not change inventory.
- Android retains Web e2e files but this alone does not prove native execution. Android native auth test is a four-screen visual flow, not all 60 functional assertions.
- Browser-only infrastructure: site availability/navigation retries, public source-map disclosure checks, proxy CORS, DOM/CSS stabilization, localStorage/deviceId injection, Chromium Freshchat script/iframe instance checks. Port business semantics independently.
- Native needs iOS proxy/CA, native touch, WebView document access and native customer-service handling. Web page.clock and DOM text mutation cannot be reused.
- Preserve three locales and all mobile business states; do not count duplicate desktop margins as new iPhone cases.
- Web share-link confirmation is .web.js; Android uses OS share sheet. Native staging prompt obscures branding fade. Verify iOS behavior, never count invisible animation as tested.
- Web lightweight game mode disables coin particles/victory sequences/some deal and seat arrows. Native navigation transitions and pull-refresh are additional native work.
- No test may silently skip required secrets, unreachable native states or failed backend requests and claim complete coverage.
- Known SETTINGS-010 Web expected failure is product default coin-mall category bug; verify iOS independently.
- Game replay is UI verification via precise staging room UUID/HTTP/WS fixtures, not real multiuser financial settlement. Own account data/wallet passes through; delete only room created by this test.
- Native baselines must use fixed simulator model/runtime/language. Existing Web PNGs cannot serve as iOS pixel baselines. Raw video alone is not animation regression comparison.
- iOS 的已审查参考图只保存一套，使用 `ios/snapshots/v1/<module>/<page>/<state>/ios/iphone16-ios18.5/<locale>/<page|animation|asset>/<sample>.png`，与 `laiwan_screenshot` 的统一路径一致。`smoke` 仅保存原始证据；`reference` 产生待审查候选；`compare` 在缺基准或图像变化时失败。PR 与 master push 默认以 `compare` 运行游客矩阵，账号业务组需要手动指定。
- 已通过的 6 组游客报告可用 `node ios/full/export-candidates.mjs <新目录> <artifact目录>...` 无损导出 PNG 候选；工具验证全部用例通过、同一模拟器 Release、PNG 数据与重名场景哈希，并写 `status: unreviewed` 的 manifest。人工逐图核对后才将 `v1/` 内容放入 `ios/snapshots/v1/`，由 PR 的 `compare` 自动验证。已知的现版布局问题：三语言 Staging 提示卡的“进入测试版”按钮被内层圆角卡遮住；参考图如收录仅记录当前真实画面，不表示接受此产品缺陷，修复后应审查视觉差异。

## 原始覆盖文档（包括全部动画子效果与当前局限）

### 来源 `e2e/cases/COVERAGE.md`

# 功能线覆盖盘点

核查日期：2026-09-27。依据已部署 staging 的实际入口、现有功能案例和
`visual/scenarios.ts` 的页面清单。视觉截图、冒烟和弱网测试不等同于功能流程通过。

## 本轮补测前

| 功能线 | 原有功能案例 | 缺口 |
| --- | --- | --- |
| 认证 | AUTH-001～003 | 手机号及区号、找回密码、协议与隐私、退出 |
| 大厅/游客 | HALL-001 私人局 tab 返回 | 搜索、快捷入口、消息/俱乐部/我的门禁、匹配入口 |
| 私人局 | 仅游客空态 | 已登录房屋、加入入口、玩法选择、实际创建及结果 |
| 俱乐部 | 无 | 搜索、创建、详情、俱乐部牌局创建 |
| 消息 | 无 | 通知分类、返回及空态/列表 |
| 个人资料/账号安全 | 无 | 资料浏览、编辑入口、安全子页 |
| 资产/商城/记录 | 无 | 余额展示、流水、购买/游戏记录、礼品卡入口 |
| 设置/帮助 | 无 | FAQ、联系/分享/官网、下载、关于、语言及应用管理 |
| 实际对局 | 无 | 入座、开始、操作、结算、多用户交互 |

## 覆盖判定

- 导航通过只代表页面与返回路径可用，不能宣称创建、支付或对局已通过。
- 创建案例须真实提交、验证响应及新建对象，并说明测试数据回收方式。
- 依赖短信/邮箱验证码、多人账号或特定资产的数据条件必须明确记录，不能用静默跳过掩盖缺口。
- 每个新增案例目录记录实际验证范围；提交后的 GitHub Actions 结果才是该提交的 CI 证据。

## 本轮新增范围

| 功能线 | 案例 | 行为边界 |
| --- | --- | --- |
| 手机号登录 | AUTH-004 | 选择区号、填写号码、切换密码方式；不发验证码 |
| 找回密码 | AUTH-005 | 邮箱/短信表单及返回；不发送验证信息 |
| 协议/隐私 | AUTH-006 | 内嵌文档真实正文及返回 |
| 测试注册 | AUTH-007 | 每轮一次测试接口创建、真实界面登录、零初始钻石及刷新后的会话 |
| 游客门禁 | HALL-002 | 俱乐部/消息/我的、搜索取消与登录、两种玩法入场提示 |
| 大厅快捷功能 | HALL-003 | 联合搜索、通知/商城/邀请往返、每日奖励只读 |
| 消息 | MESSAGE-001 | 三类通知、空态与我的俱乐部通知入口 |
| 个人资料 | SETTINGS-001 | 资料预填、昵称/签名取消编辑、等级说明 |
| 账号安全 | SETTINGS-002 | 绑定手机/邮箱、改密、注销首屏及安全返回 |
| 资产/商城 | SETTINGS-003 | 商品和价格、真实注册奖励流水、购买记录、礼品卡标签与兑换入口 |
| 帮助/下载 | SETTINGS-004 | 客服入口、FAQ 详情、四种平台下载说明 |
| 偏好/关于 | SETTINGS-005 | 当前语言、版本、官网、分享、Telegram |
| 游戏记录 | SETTINGS-006 | 独立账号的真实战绩空态及返回 |
| 私人牌局 | PRIVATE-001 | 真实创建、进入牌桌、退出、解散、扣钻与退款 |
| 建房配置 | PRIVATE-002 | 经典德州、拼三张、短牌配置和高级设置，返回后不扣费 |
| 俱乐部创建 | CLUB-001 | 必填校验、真实扣费创建、详情、独立读取及创建人归属 |
| 俱乐部牌局 | CLUB-002 | 独立建俱乐部及牌局、退出、解散与牌局退款 |
| 俱乐部搜索 | CLUB-003 | 列表标签导航、真实搜索请求、清空与返回 |
| 私人牌局加入 | PRIVATE-003 | 第二独立账号按新建房号进入同一牌桌、退出并回收牌局 |
| 俱乐部成员管理 | CLUB-004 | 两个独立账号加入后，房主连续移除两人、取消编辑，并核对页面人数及服务端成员列表 |
| 俱乐部入会 | CLUB-005 | 搜索申请、同意与拒绝审批、邀请链接解析后的申请审批、真实成员关系及成员退出 |

此表表示测试设计范围，不把尚未通过 CI 的实现计为通过。

## 仍需独立条件的流程

- 短信/邮箱验证码后续、实际改密与账号注销。
- 支付购买、礼品卡实际兑换，以及买入申请等其他通知的详情/审批；俱乐部入会申请的同意与拒绝由 CLUB-005 覆盖。
- 实际对局的入座、开始、下注、结算和多人交互；当前牌局案例止于未开始状态。
- H5 不接收原生邀请链接事件；CLUB-005 核对真实生成、解析及申请审批，不覆盖链接在原生应用中的唤起。
- 第三方反馈网站内容、slot 实际抽奖及真实匹配。大厅玩法切换按钮本轮点击未观察到变化，不能据此声称切换通过。
- 创建俱乐部消耗 50 钻，随后建牌局另需 10 钻；创建 fixture 在每例开始前通过 staging 测试接口将专用账号设为 60 钻，并读取钱包确认；CI 需要 TESTING_API_TOKEN。
- 本轮观察到 staging 全量俱乐部列表请求间歇返回网络提示；确认提示不等于列表功能通过。创建结果另外通过新对象详情读取验证，完整列表加载仍需后端恢复后单独核查。
- 私人及俱乐部牌局有已核实的解散路径；俱乐部创建者没有已核实的删除/退出入口，独立账号创建的 E2E 俱乐部保留在 staging，不能声称已自动回收。

## 2026-09-27 补充回归

用户已明确本轮先不创建数据，执行 `npm run test:functional:existing`。
AUTH-007、CLUB-001、CLUB-002、PRIVATE-001 标记为 `@creates-data`，不计入本轮通过数。
完整案例保留；功能 CI 默认同样使用 existing，手动选择 all 才运行创建流程。

| 缺口 | 补充案例／修改 | 检查内容 |
| --- | --- | --- |
| 登录只测正常填入 | AUTH-008 | 空值、短密码、清空后再次禁用；邮箱格式无效／恢复 |
| 语言只测列表展示 | AUTH-009 | 三种语言确认保存、重新加载、实际翻译和选中状态 |
| 退出流程缺失 | AUTH-010 | 取消退出、确认退出、游客资产、刷新后不恢复会话、门禁 |
| 部分快捷入口漏测 | HALL-004 | 抽奖、每日奖励、商城、创建／加入私人房间的游客引导和取消重开 |
| 免费抽奖完全未覆盖 | SLOT-001 | 已登录面板、能量、三类奖品、关闭重开、钻石余额不变；不抽奖 |
| 联合搜索只等响应 | HALL-003 | 匹配实际搜索关键字，验证俱乐部 HTTP、业务成功及空数组 |
| 测试初始化掩盖语言保存 | `_shared/page.ts` | 仅首次设置简中，刷新保留用户偏好 |
| 注册错误诊断过于笼统 | `RegistrationRejectedError` | 保留已确认的网络注册限额文案，不输出原始响应和凭据 |

第一轮原有 66 项中 58 项通过；其余 8 项为专用创建账号缺失或注册受限。
已用 agent-browser 确认服务器提示“此网络已达注册上限，请稍后再试”；
`TESTING_API_TOKEN` 的相邻部署文件读取正常，不能把此问题误诊为 token 缺失。

截图基准与真实业务测试分开：视觉用例固定易变内容和部分接口数据，不能替代后端结果验证。
页面截图统一在 [来玩截图中心](https://github.com/ac-gp/laiwan_screenshot) 浏览，
在该仓库运行 `bun start`，通过服务电脑的局域网 IP 和端口 53127 访问。

### 本地执行结果

- existing 范围：23 个案例文件，78 项桌面／手机测试。整轮 76 项通过，联合搜索的 2 项因测试误写 HTTP 方法失败；核实真实接口使用 PUT 并修正后，两项复测通过。最终整轮结果以本次提交的 GitHub Actions 为准。
- staging 可用性 1 项、弱网及恢复 3 项通过；大厅超时案例现在验证解除故障后真实列表恢复。
- 视觉场景单元测试 47 项通过，视觉浏览器辅助测试 22 项通过；功能与视觉 TypeScript 检查通过。
- 本轮新增登录校验、语言持久化、退出、游客快捷入口、抽奖面板共 20 项桌面／手机检查。
- 截图矩阵扩展到简中 102 张、三语言 306 张；视觉基准采用 Linux 浏览器。仅表单和面板覆盖不等于提交、支付或实际游戏通过。

初轮未重新执行注册；随后按用户补充要求等待一小时后重试了一次，结果见下文。未创建俱乐部或牌局，也没有领取奖励、抽奖、支付、发送验证码或修改账号资料。

视觉复核发现旧「大厅匹配区」基线仍使用两行私人房入口文案。应用仓库已合并的
[830a6ce0b](https://github.com/kevinanew/laiwan_react_native/commit/830a6ce0bfa859b64222d78f8a77dc389199914f)
将其改成完整本地化单行标题；同步遗漏基线时保留现有像素比较标准，不通过放宽阈值忽略差异。

### 已推送版本的 CI 结果

提交 `8489e68`：

- [H5 E2E](https://github.com/kevinanew/clrn/actions/runs/36267302557)：18 项通过。
- [线上功能案例](https://github.com/kevinanew/clrn/actions/runs/36267302560)：完整 existing 范围 78 项通过（8.6 分钟），无跳过或重试。
- [H5 Visual Regression](https://github.com/kevinanew/clrn/actions/runs/36267302580)：40 张核心截图比较通过，包含本轮新增页面。
- 三语言大厅匹配区基线同步后，另行执行了 3 项独立截图比较，全部通过。

钱包服务 `user_transaction_flask` 的 master 提交 `a475b758`
已通过 [C5 #326](https://c5.shafayouxi.org/kevinanew/user_transaction_flask/326) 的全部 8 个步骤，
包括部署及部署后 E2E；该 E2E 包含 `set_balance` 的金币／钻石设置、幂等及错误 token 检查。
此部署结果不等于本仓库的俱乐部和牌局创建测试已执行。

### 等待一小时后的注册重试

用户于 2026-09-27 03:50:50（UTC+8）要求等一小时后重试。
实际启动时间为 **04:50:50.006**，桌面项目在真实注册接口阶段再次收到
“此网络已达注册上限，请稍后再试”；手机项目被本轮单次注册保护拦截，没有再次注册。
因此这两项不能记为通过，新增的奖励流水、账号身份与刷新后会话／余额断言尚未到达。
注册限制未解除，与已经部署成功的 `set_balance` 接口是两个独立条件。

注册案例已补充以下检查与执行入口：

- 用户名和注册奖励余额一致、真实奖励流水、刷新后保持同一账号及余额、无额外注册请求。
- 手机上下文改为一次性 `setStorageState`，不在刷新时强制重写登录缓存。
- `npm run test:functional:registration` 和手动 CI 的 `scope=registration` 仅运行注册案例；自动 push 仍运行 existing。

本轮不通过跳过、mock 注册成功或重复注册来规避限额。解除限额后可用上述命令继续真实验证。

### 2026-09-28 测试账号准备方式调整

AUTH-007 改用 `POST /public/v10/user/register/username_password/testing` 和
`X-Testing-Api-Token`，随后从真实界面登录。初始钻石必须为 0，不再断言注册奖励及奖励流水。
上述普通注册限额及奖励检查记录为历史结果；新接口不检查 IP／设备注册频率，
失败时仍明确失败，不重试或回退。registration 范围现在必须配置 TESTING_API_TOKEN。
本次本地 helper 验证与静态检查不代表线上浏览器案例已通过。

### 2026-10-01 俱乐部成员回归补充

CLUB-004 使用两个动态测试账号和真实申请、审批接口准备成员，增加 Issue #6792 的真实页面回归：先移除一人，选中另一人后取消编辑，再次编辑并移除第二人；每次核对删除响应、页面人数和服务端成员列表。失败时尝试移除本例账号并核对最终成员列表。俱乐部本身仍保留在 staging，创建类案例只在 `scope=all` 或显式运行该案例时执行。桌面、手机各一项已在本地 staging 通过；弱网 3 项和一个已有账号只读案例也通过，提交后的 CI 结果仍需单独核对。CLUB-005 的旧搜索定位未生成 DOM 元素，改为实际可见卡片定位；本轮真实运行到 `PUT /v1/share_link/generate` 时返回 HTTP 404，未将邀请流程记为通过。

## 2026-10-09 应用仓库补充案例迁入

应用仓库经 agent-browser 探索后新增的 27 个业务场景，按本仓库实际断言删除 13 个重复场景，剩余 14 个场景迁入本仓库。按既有案例规范新增 12 个案例目录（PRIVATE-005 包含三种玩法），桌面／手机共 28 项。沿用现有 staging 白名单、已有账号 fixture、串行执行及关闭网络 trace 的配置；自动 existing CI 包含这些不创建数据的案例。

| 案例 | 新增行为 | 场景数 |
| --- | --- | --- |
| [AUTH-011](auth-011-username-password-boundaries/README.md) | 用户名规范化和输入长度上限 | 1 |
| [SETTINGS-007](settings-007-password-boundaries/README.md) | 修改密码长度边界 | 1 |
| [CLUB-006](club-006-create-form-boundaries/README.md) | 创建俱乐部表单反向校验 | 1 |
| [SETTINGS-008](settings-008-language-cancel/README.md) | 语言预览取消 | 1 |
| [SETTINGS-009](settings-009-text-faq/README.md) | 文字 FAQ 答案 | 1 |
| [SETTINGS-010](settings-010-coin-mall-entry/README.md) | 金币余额进入商城 | 1 |
| [SETTINGS-011](settings-011-mall-categories/README.md) | 金币与钻石商品切换 | 1 |
| [SETTINGS-012](settings-012-wallet-currencies/README.md) | 钱包流水币种切换 | 1 |
| [MESSAGE-002](message-002-buy-in-tabs/README.md) | 带入通知处理状态切换 | 1 |
| [PRIVATE-004](private-004-room-number-validation/README.md) | 私人房号输入限制 | 1 |
| [PRIVATE-005](private-005-buy-in-audit-toggle/README.md) | 三种玩法带入审核开关 | 3 |
| [HALL-005](hall-005-search-clear-state/README.md) | 清空搜索恢复默认引导 | 1 |

删除的重复场景包括游客五标签门禁、登录与刷新、找回邮箱校验、昵称／签名取消、注销返回、语言确认保存、下载帮助、通知空态、订单／礼品卡浏览和退出刷新；基础表单及建房规则的重复断言也未再次迁入。

所有新增测试均通过真实页面及接口验证，不提交改密、俱乐部／牌局创建、加入房间或支付。金币入口的历史错页属于应用行为问题，测试保留默认金币分类的预期；仅该断言标为预期失败，其他准备和余额断言仍按普通失败处理。应用修复后 unexpected pass 会要求移除标记。历史 26/28 通过是迁移前应用仓库的结果，不能当作本次 clrn 验证结果。

### 迁入后的本地验证

首次串行执行 28 项：24 项通过、4 项失败。其中两项是已确认的金币入口产品错页，另外两项是迁移时提前检查未挂载金币内容的时序问题。后者已将唯一性检查移到真实分类点击之后。修改后的两个商城案例共 4 项复测运行成功：商品切换桌面／手机两项实际通过，金币入口桌面／手机两项为已确认产品故障的预期失败，不能记作业务通过。其余 24 项没有修改测试行为。

严格 TypeScript、`npm run lint`（每文件最多 400 行）及 `git diff --check` 通过。`test:functional:existing -- --list` 为 106 项、35 个案例文件，含本次新增 28 项。提交后的完整 CI 结果单独核对。

### 钱包流水审查修复验证

SETTINGS-012 增加 HTTP／业务成功、响应币种、流水数组及字段校验，并将首条流水的收支金额、余额、时间与目标列表实际展示对应；切回金币后再次核对内容。条目币种兼容真实简中响应的“金币／钻石”，响应顶层仍严格要求 coin／diamond；合法空流水不要求造数据。

独立隔离浏览器复现：将钻石响应替换为真实金币响应时，原业务断言桌面／手机两项均错误通过；修复后两项均在响应币种断言处失败。相同业务用例使用合法空流水响应时两项通过，此故障注入验证不计作真实业务通过。新增 `test-wallet-statements.spec.ts` 的 14 项辅助回归全部通过，覆盖两个视口的错误展示、空容器、空数据、离屏列表及业务／结构错误，已由现有 H5 E2E CI 的 `npm test` 自动发现。

完整复查本 PR 的全部代码和文档 diff，并执行新增 28 项业务场景。首轮出现搜索 HTTP、登录前置及会话失效导致的失败，并发现新校验需兼容条目本地化名称；调整后对搜索、房号、三种玩法及钱包共 12 项桌面／手机测试串行复测，全部通过。结合整轮其他场景，26 项实际业务得到通过验证，金币入口两项仍为 base 产品错页的预期失败，不计业务通过；本次未修改产品代码或该遗留问题。最终严格 TypeScript、行数检查和 diff 空白检查通过，existing 仍发现 106 项、35 个文件；本地结果不代替提交后的完整 CI。


### 来源 `e2e/INTERACTIONS.md`

# H5 交互与 Freshchat E2E

滚动、触屏交互与 Freshchat 套件从应用仓库迁入本目录，复用现有账号与导航辅助代码。

测试账号、权限和登录方法统一记录在 [测试账号与权限](accounts.md)。
这是独立 npm 子项目，不构建应用；默认访问 staging，也可通过环境变量指定本地构建。

## 运行

```bash
cd e2e
npm ci
npx playwright install chromium # 本机首次安装或升级时执行
node ../scripts/with-test-account.mjs -- npm run test:interactions
node ../scripts/with-test-account.mjs -- npm run test:freshchat
npm run report
```

### 滚动与交互回归

`npm run test:interactions` 使用独立配置，分别运行桌面 Chromium 和启用移动设备、触摸能力的 Chromium。覆盖大厅上下滚动、我的设置列表后续条目导航、申请标签横滑与触底分页、建房弹层关闭及滑块拖拽、大厅和俱乐部故障后的重试恢复。

桌面发送鼠标滚轮与拖拽，触屏通过 Chromium 输入协议发送连续触摸事件；不改写 `scrollTop`，不使用强制点击、JS 点击或隐藏遮罩。断言包括滚动位置、可见内容、分页游标及请求次数、滑块数值和重试后的可操作性。此配置验证 H5，不代表原生 iOS/Android 或 Safari 已覆盖。

默认目标是 staging。验证当前修改时，先在项目根目录构建并启动本地 H5，再在本目录执行：

```bash
E2E_INTERACTION_BASE_URL=http://127.0.0.1:9087 npm run test:interactions
E2E_INTERACTION_BASE_URL=http://127.0.0.1:9087 npm run test:interactions -- --project touch
```

账号池启动脚本设置 `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD`，真实登录会话仅保存在内存中。每轮内部桌面与触屏串行运行；本机不同轮次通过账号池使用独立账号。长列表及故障只在 HTTP 边界提供固定响应，其余仍访问 staging；不提交建房或审批操作。仅对 staging 或连接 staging 的本地构建运行此套件。

交互套件需显式运行。失败截图与页面错误上下文位于 `test-results/interactions/`。

### Freshchat 在线客服

`npm run test:freshchat` 复用真实 staging 登录，在桌面和触屏 Chromium 中依次进入「我的 → 联系客服 → 在线客服」。保留真实 Freshchat 脚本、网络请求和跨域 iframe，检查 SDK 加载、入口打开聊天窗口、消息草稿输入与清空、点击窗口关闭按钮、再次通过入口打开，以及脚本和 iframe 没有重复创建。仅编辑草稿，不发送消息或创建客服工单；不覆盖消息送达、客服回复或原生 SDK。

账号通过 `E2E_TEST_USERNAME` / `E2E_TEST_PASSWORD` 覆盖，目标通过 `E2E_INTERACTION_BASE_URL` 覆盖，默认 staging。与其它使用同一账号的测试串行执行。登录浏览器上下文显式继承项目语言配置，避免 Linux 默认 `en-US@posix` 导致应用启动异常。页面导航复用最多三次尝试的有限重试，登录准备和客服场景分别有六分钟总预算，各阶段仍有独立超时（Freshchat 加载最多 60 秒）。失败截图和页面错误上下文保存在 `test-results/freshchat/`；真实第三方服务持续不可用时测试必须失败，默认仅重试一次，可用 `E2E_RETRIES=0` 关闭重试。网络 trace 关闭，避免报告保存真实账号池密码。

客服用例已加入现有 `e2e/interactions/` 套件，执行 `npm run test:interactions` 会一起运行，也可通过 `npm run test:freshchat` 单独运行。它检查当前已部署 staging 的客服可用性；功能分支上的应用变更仍需先部署到 staging 或本地构建，再指定目标 URL 验证。

## 测试资产边界

需要调整测试账号资产时，只允许操作 staging：减少资产使用 `POST /v11/wallet/<user_id>/withdraw`，增加资产使用 `POST /service/v11/wallet/<user_id>/deposit`。`currency_name` 仅使用 `coin` 或 `diamond`，`amount` 为非负数，每次使用新的 UUID `transaction_id`。Production E2E 仅允许不会修改用户资产和业务数据的只读检查。

## CI

`.github/workflows/interactions.yml` 在本套件、公共辅助代码、依赖及工作流变更时运行，
也支持手动触发。先运行不含客服的交互场景，再单独运行 Freshchat，桌面与触屏串行执行。
任务从 100 个 CI 专用账号中按运行 ID 分配账号，以 `h5-staging-account-<用户名>`
作为 job 并发组，并设置 `queue: max`。不同账号的任务可以并行，同一账号的任务排队。
凭据从 `CLRN_CI_TEST_ACCOUNTS_V3` Actions Secret 注入，与本机账号池分开。
目标读取仓库变量 `E2E_STAGING_URL`；Playwright 镜像与本目录锁文件均为 `1.59.1`。
失败上传页面错误上下文、截图与 HTML 报告。
部署说明见 [应用仓库 Web 文档](https://github.com/kevinanew/laiwan_react_native/blob/master/docs/web/README.md)。


### 来源 `visual/animations/COVERAGE.md`

# 动画覆盖清单

范围：本仓库负责的线上 H5。基准目标部署为 `2a447047bdb28d1536dad5915374d6527055dcb4`。
下表中的用例均已生成 Linux 基准，并通过手机、桌面连续三轮比较（零重试）。

## 验证记录

2026-10-16，[Linux 验证流水线 38804279584](https://github.com/kevinanew/clrn/actions/runs/38804279584)
验证测试代码 `22e07b7`，测试前后均确认上述应用版本未变。

| 套件 | 手机 / 桌面用例数合计 | 三轮比较通过数 | 新增 PNG 基准 |
| --- | ---: | ---: | ---: |
| 大厅及通用界面 | 27 | 81 | 304 |
| 德州 | 10 | 30 | 903 |
| 拼三张 | 4 | 12 | 394 |
| 合计 | 41 | 123 | 1601 |

保留原有 4 张搜索弹窗基准，合计 1605 张 PNG；另有 15 份素材尺寸与帧时长记录。
117 个素材原始帧已计入 PNG 数量。候选图经过画面检查、文件完整性校验，并与 CI 产物逐字节核对后入库。
仓库检查通过 99 项 Node 测试，拼三张隔离代理通过 18 项 Python 测试，类型及 lint 检查通过。

## 效果与用例

| 效果 | 用例 / 关键帧前缀 | 检查范围 |
| --- | --- | --- |
| 启动品牌淡入 | `ambient.spec.ts` / `launch-branding` | 初始透明、中间帧、500ms 完成 |
| 测试版提示及分享链接确认 | `dialogs.spec.ts` | Paper Dialog 淡入/缩放，分享确认退场及重开；启动提示确认后进入大厅 |
| 大厅老虎机横幅 | `ambient.spec.ts` / `hall-slot-banner` | 自动旋转及下一轮 |
| 搜索确认弹窗 | `application.spec.ts`、`search-prompt.spec.ts` | 淡入、淡出、重开、实际透明度 |
| 俱乐部更多菜单 | `application.spec.ts` / `club-more` | 入退场及重开 |
| 邀请朋友底部抽屉 | `application.spec.ts` / `invite-friends` | 位移、透明度、退场后入口 |
| 创建房间玩法选择器 | `application.spec.ts` / `game-picker` | BottomSheet 入退场 |
| 俱乐部空态 | `application.spec.ts` / `club-empty` | Moti 内容淡入 |
| 大厅匹配 | `application.spec.ts` / `hall-matching` | CSS 旋转、展示及取消 |
| 俱乐部列表骨架 | `skeleton.spec.ts` / `club-list-skeleton` | 响应暂缓时脉动，释放后真实列表 |
| 完整老虎机 | `slot.spec.ts` / `slot-*` | 三个滚轮、金币/钻石/能量奖励 |
| 老虎机面板及能量不足提示 | `slotPopups.spec.ts` | 入退场、实际错误响应触发 |
| 两种牌桌菜单、牌型、主题、设置 | `tablePanels.ts` | 每个入口分别入退场和重开 |
| 两种牌桌带入、续费、排行榜、牌谱、聊天、申请 | `tablePanels.ts` | 各面板入退场和遮罩释放 |
| 拼三张空座引导箭头 | `tablePanels.ts` / `zhajinhua-seat-guides` | 循环关键帧 |
| 德州公共牌 | `texasGameplay.ts` / `texas-flop/turn/river` | 翻牌、转牌、河牌及牌面断言 |
| 德州玩家行动 | `texasGameplay.ts` / `texas-call/raise/check/fold` | 状态、下注及筹码变化 |
| 德州倒计时及操作区切换 | `texasGameplay.ts` / `texas-countdown-operation-switch` | 计时进度及操作区变换 |
| 德州加注、精确加注、玩家资料 | `texasGameplay.ts` | 入退场及重开 |
| 德州全压、摊牌、结算 | `texasGameplay.ts` | 手牌、皇冠、净收益、余额；火焰素材另测 |
| 两种牌桌各自的经验与升级 | `texasGameplay.ts`、`zhajinhuaFeedback.ts` | 真实操作响应触发，展示与离场 |
| 拼三张玩家倒计时 | `zhajinhuaFeedback.ts` / `zhajinhua-countdown` | 数字、进度及颜色变化 |
| 拼三张发牌、看牌、加注、比牌、摊牌、结算 | `zhajinhuaGameplay.ts` | 十五张牌的飞行、翻牌、比牌往返、胜负、余额 |
| 拼三张精确加注、比牌目标闪烁 | `zhajinhuaGameplay.ts` | 精确加注入退场、四个目标循环闪烁 |
| 弹幕 | `texasSocial.ts` / `texas-barrage` | 固定随机高度后的真实移动轨迹 |
| 消息操作、举报、屏蔽、语音 | `texasSocial.ts` | 入退场；不发送录音或举报 |
| 带入审核及错误提示 | `texasSocial.ts` | 房间消息/失败响应触发入退场 |
| 自动补充带入、合谋举报、个人排行榜 | `texasHall.ts` | 现有大厅响应夹具下的真实入口 |
| 系统提示、加载中 | `texasFeedback.ts` | 消息触发提示淡入和消失；暂缓响应下双层旋转 |
| 全部 7 种表情、7 种道具、全压火焰 | `texasAssets.ts`、`imageFrames.ts` | 真实素材逐帧与时长；道具飞行轨迹 |

## 平台差异与当前不可达的入口

- 德州 H5 的轻量模式关闭金币粒子、胜利背景序列以及部分发牌/空座箭头动画。
  测试不得改写 `Device.isWeb` 强行打开；保留 H5 实际效果与静态断言。
- `TreasureBox` 在当前源码仅有导出，没有实际消费入口；不能以直接挂载测试组件冒充正常页面覆盖。
- 独立 `MatchTexasHoldem` 热气球页面依赖浮窗匹配状态，现有 H5 场景不可达。
- RTC、下一手下注记录、重新匹配、拼三张独立加注滑杆的入口限制沿用各牌桌已有 `COVERAGE.md`。
- 俱乐部房间骨架仅用于旧引擎房间缺失信息的分支。当前 React Native 引擎响应在构造时即设置
  `isAllInformationLoaded=true`，旧版德州已下线。
- React Navigation 的 Stack 在 Web 平台默认使用 `animation: none`。实际账号安全页入栈采样也没有位移或渐变，
  因此不将普通导航列为已覆盖动画，不强制打开原生平台的转场。
- 原生专属动画属于 `clrn-az` 范围，不由本仓库的 H5 截图证明。


### 来源 `visual/cases/texas-holdem/COVERAGE.md`

# 德州视觉覆盖

测试访问已部署的 staging Web，对照 `laiwan_react_native` 源码 `45709ff3d` 的
`src/texas_holdem_react_native/main/MainScreen.js` 及其引用组件整理界面。
截图反映运行时的部署版本；源码中存在组件不等于部署版本有可用入口。

当前基准为每种语言 desktop/mobile 两个视口、每视口 95 张，共 570 张德州基准图。
本轮补齐 33 个状态及其 198 张 Linux 基准，全部纳入核心 CI。
三种语言为 `zh-Hans`、`zh-Hant`、`en`。场景清单以 [scenarios.ts](scenarios.ts) 为准，
新增状态必须同时提供六张 Linux 基准图，完整性测试会检查缺失和多余图片。

翻牌圈截图前明确检查三张公共牌和本人两张手牌的精灵图数量、可见性与加载透明度；
手机端同时检查回放玩家的动作提示位于昵称下方。这些检查接替客户端已删除的本地固定组件用例。

| 源码界面 / 数据状态 | 截图状态 |
| --- | --- |
| 等待牌桌、菜单 | `pre_game`: waiting_table、menu |
| 牌型、主题、游戏设置 | card_rank、theme、settings；`panels`: 三种额外牌面、三种桌布、settings_enabled |
| 带入、续费、带入申请 | buy_in、renew、buy_in_applications；buy_in_review |
| 升盲配置 | `optional_pre_game`: waiting_table、raise_blinds |
| 各轮牌桌、手牌强度 | `game`: preflop、flop、turn、river |
| 加注、精确加注、预选操作 | raise、accurate_raise、opponent_turn |
| 全下、摊牌、结算 | all_in、showdown、settlement |
| 本人/其他玩家资料、百手/千手统计、统计说明 | own_profile、player_profile、player_statistics_1000、statistics_help |
| 举报、屏蔽玩家 | report、block；chat_report、chat_block_confirm |
| 排行榜 | 空列表 leaderboard、有玩家 leaderboard_players、大厅 personal_leaderboard |
| 牌谱 | 旧版空牌谱 game_record、record_settlement、record_actions；新版 `records_v2`: empty、actions、settlement |
| 聊天、语音 | 表情 chat、快捷短语 chat_phrases、chat_history、chat_actions、voice |
| 结束后亮牌、查看剩余公共牌 | hand_end、remaining_cards、show_cards |
| 退出确认 | quit_confirm |
| 大厅专属工具栏、菜单 | hall_table、hall_menu |
| 自动补充筹码、合伙作弊举报 | auto_rebuy、pair_play_report |
| 下一手猜牌、猜牌结果、升级 | prediction、prediction_result、level_up |

以下为本轮新增用例，每个状态均有六张 Linux 基准图：

| 源码界面 / 数据状态 | 截图状态 |
| --- | --- |
| 过牌、仅全下、全下与跟注、大小盲倍数快捷加注、禁用快捷按钮 | `controls`: check、all_in_only、all_in_call、shortcut_blinds、shortcut_disabled |
| 预选按钮及三种选中状态 | auto_buttons、auto_fold_selected、auto_call_selected、auto_check_selected；opponent_turn 也断言预选按钮实际显示 |
| 滑杆最大值、拖动辅助、精确金额、低于最小金额提示 | raise_maximum、raise_dragging、accurate_raise_value、accurate_raise_minimum_error |
| 观察者、九人满桌、满桌多底池、保留座位、掉线、非房主菜单 | `table_states`: observer、full_table、full_table_multiple_pots、reserved_seat、player_disconnected、guest_menu |
| 非空带入申请：待审批、通过/拒绝/过期、加载更多 | `panel_variants`: applications_pending、applications_resolved、applications_more |
| 语音历史行、弹幕关闭 | chat_audio_history、chat_barrage_off |
| 重试、余额不足、认证失败弹窗 | alert_retry、alert_insufficient_balance、alert_authentication_failed |
| 自动补码开启、已选举报玩家及理由 | `hall_variants`: auto_rebuy_enabled、pair_play_selected |
| 下注成功、猜牌亏损、钻石结果、加时冷却及提示 | prediction_bet、prediction_loss、prediction_diamond、delay_cooldown、delay_cooldown_alert |

新增 `full_table_multiple_pots` 回放九个底池 `[90, 80, 70, 60, 50, 40, 30, 20, 10]`，合计 `450`；截图前检查九人、全部金额、两列五行、末项可见和每项均位于列表范围内。该状态复用 `signed_in_texas_table_states`，纳入核心及全量回归，覆盖三种语言和两个视口。

九人满桌按座位回放 BTN、SB、BB、UTG、MP1、MP2、MP3、HJ、CO；截图前逐玩家断言位置标签可见，并检查庄家 D 标记。

## 代理边界

App 直连，德州只加载本目录 [proxy.ts](proxy.ts) 和 [mitmproxy/addon.py](mitmproxy/addon.py)。
E2E 故障代理的场景和脚本完全独立。共享进程管理、临时 CA、本地控制客户端，以及 `e2e/mitmproxy/response_overrides.py` 的最小字段覆盖工具。
zhajinhua 应使用自己的目录及控制命令，方便分别调试。

每个分片通过真实 UI 登录一次，每例再通过真实 UI 创建私人房；大厅显示配置只修改这次成功创建的房间 UUID。
大厅自动入座在订阅前就被隔离，测试只建立真实观察者连接。
固定消息通过 mitmproxy 的 WebSocket 注入发送给浏览器，组件仍走实际 Centrifuge v2 恢复协议。
代理保留 ping、订阅、其他房间/用户消息以及混合批次中的其他 RPC。
回放房间的操作、查看公共牌和加时支付由夹具响应，不在服务端开局或真实下注。
申请列表、自动补码、猜牌操作及错误响应同样只匹配本例房间、准确路径和请求方法；
控制接口验证口令，解除回放时清空状态。非房主身份只修改本次已创建房间的详情响应。
资料与统计夹具只匹配虚拟玩家，本人资料、余额及统计走真实接口；混合资料批次保留真实本人并补入虚拟对手。牌谱夹具只匹配本房间，新版仅覆盖真实版本响应的版本字段，
牌谱请求还必须匹配本次真实入房响应中的 play_session_id。结束时解除回放并删除本次房间。

页面时钟从导航前安装，连接后暂停并推进固定时间，等待翻牌、筹码动画及随机位置弹幕退场。
语音使用 Chromium 虚拟麦克风，仅截图弹窗，不录制或发送语音。
只有房号、昵称、余额、延迟等易变文本固定；不修改 React 组件实例或内部状态。
正式图片只在 Docker/Linux 生成；德州 reference 会重写所选状态，避免容差内的旧画面残留。临时 CA、登录态、网络请求正文不提交、不上传。

### 本人资料基准与真实数据

`5913d04` 将本人资料、余额和统计改为透传，但此前六张 `own_profile` 基准仍保留
`TestPlayer`、等级 5、金币 12345 和模拟百手统计，导致真实账号打开资料时截图失败。
2026-10-14 按三种语言和两个视口重新采集 Linux 基准，核对为账号池当前的
`Testing User`、等级 1、金币 0 和真实空统计。只更新本人资料截图，不恢复本人接口夹具。
账号池资料或真实统计变化时，应核实数据变化后审查相应差异，不自动接受整套新基准。

实时收益面板的资料和统计独立加载。截图前同时检查本人资料 HTTP／业务成功、非空昵称及
实际显示内容，再将昵称固定为 `TestPlayer`；不能仅等待回放统计数字就接受缺少昵称的画面。

## 当前入口限制

以下界面尚无有效截图，不能把它们计入覆盖数：

- **RTC 面板**：`MainScreen._initializeState` 将 `allowPlayerRTC` 设为 false；
  `_renderRTCPanel` 依赖它，而 `_createChatRoom` 等待面板 ref。创建成功才将开关设为 true，
  因此存在首次初始化循环，正常 UI/聊天室推送不能打开面板。
- **猜牌记录**：`_queryRoomInfo` 更新 `allowBetNextHand` 后立即调用 `DrawerMenu.setOptions`，
  子组件读到旧 `showItemRecord`；之后没有随 props 更新重算选项。真实重连只刷新牌局状态，
  管理员入口也跳过记录菜单的插入。猜牌入口和结果本身已经覆盖。
- **换房匹配提示**：普通菜单过滤掉 rematch，源码标注其换房流程已失效。
  管理员、原生专属摄像头/录音状态和第三方客服内容不冒充普通 Web 界面。
- **系统静音说明**：`GameTopToolbar` 的 `isSystemMuted` 初始为 false，只有原生
  `react-native-volume-manager` 静音/铃声事件将其设为 true；Web 没有实际触发入口。

- **新版牌谱末尾符号说明**：当前 Web 动作列表未形成受约束的内部滚动区，
  设置列表 scrollTop 不移动内容，移动端末尾说明和底部分页被挤出视口。
  因此只覆盖实际空牌谱、动作、结算，不用与动作页完全相同的图片冒充独立符号页。
  结算页客服按钮覆盖部分公共牌也是当前部署的实际布局，基准保留该画面。

上游修复入口或布局后应补充对应场景及六张基准图，并保留真实 UI 打开方式。


### 来源 `visual/cases/zhajinhua/COVERAGE.md`

# 拼三张视觉覆盖

拼三张单独使用 `VISUAL_SUITE=zhajinhua`、账号 `laiwanvisualzjh01` 和本目录代理。
三语言 × 桌面/手机 × 26 个状态 = 156 张 Linux 基准；全部纳入核心 CI。
建房表单仍由 App 场景覆盖。运行：`cd visual && pnpm run test:zhajinhua`。

| 流程 | 截图状态 |
| --- | --- |
| 真实私人房开局前 | waiting_table、menu、card_rank、theme、settings、buy_in、renew、leaderboard、game_record、chat、buy_in_applications |
| 主题与设置 | theme_four_color、theme_four_color_two、theme_realistic、table_blue、table_purple、table_black、settings_enabled |
| 三张手牌与操作 | blind_cards、seen_cards、quick_raise、accurate_raise、challenge_select、opponent_turn |
| 摊牌与结算 | showdown、settlement |

每例通过真实 UI 创建房间，进入真实游戏连接。开局前截图不启动房间计时、不带入。
牌局过程通过本目录 `zhajinhua_replay.py` 使用 Centrifuge v2 publication 回放，
三张手牌、轮数、单底池、比牌选择使用拼三张协议，不引用德州回放或数据夹具。
面板由实际 UI 打开，不注入组件状态。回放只接受本例成功建房响应的 UUID，
只隔离该房间的操作 RPC，保留其他房间、订阅、ping 及混合批次中的其他请求。
HTTP 资料与余额只为虚拟对手提供夹具，本人走真实接口；混合资料批次保留真实本人，再补入虚拟对手。
节点列表只在真实成功响应中筛选固定节点；该节点的健康检查与预检透传，真实错误和新增字段不会被固定成功响应掩盖。
RPC 可走连接池中未订阅该频道的连接，因此按已确认归属的房间 UUID 隔离，不按发送连接过滤。
结束时先直连删除本次创建的房间，再解除回放；失败时也清理。

牌局回放时暂停页面时钟、推进动画完成时间；开局前沿用德州的正常页面时钟。
初次恢复桌面后等待五位玩家挂载，再同步运行状态，并断言不再显示等待开局提示。
开局前空座位的引导箭头通过 JS transform 循环运动，截图仅固定其初始位置；
仍校验九个箭头的存在与原始尺寸，不隐藏引导或修改桌面布局。
截图固定房号、房间名、余额和延迟。
`0ms` 是截图固定文案。代理只固定 staging 网络节点和本例回放玩家资料。
正式基准仅在 Docker/Linux 中生成；登录态、临时 CA、请求正文不提交。

## 当前边界

- **手机布局**：375×812 的牌局中，房间名与快捷加注按钮重叠；Linux 闷牌截图已复现。
  基准保留当前线上布局，不通过遮罩或调整应用样式掩盖问题。
- **牌型关闭**：Linux 繁中桌面曾出现透明层拦截关闭图标点击，截图中图标仍可见。
  本轮使用该弹窗已有的遮罩关闭入口推进截图流程，不验证关闭图标的点击行为。
- **滑杆加注弹窗**：当前 `MainScreen._onPressRaise` 和 `_onPressShortcut` 直接调用 `_raise`，
  `RaiseBetPopup` 没有 UI 打开入口。覆盖实际快捷加注及精确加注，不伪造该弹窗截图。
- 大厅专属自动补充筹码、合伙作弊举报、升级、玩家资料、语音、聊天历史、非空牌谱、
  带入审核、比牌动画和可选规则尚未纳入本轮场景，不能按德州覆盖数算入拼三张。
- 当前回放使用私人九座桌、五位玩家，真实服务端房间保持等待状态，不在服务端开局或下注。
  建房仍消耗 staging 钻石，余额不足时沿用固定账号的补钻机制。

补充范围时应增加实际 UI 流程、明确就绪断言和对应的六张 Linux 基准。


### 来源 `visual/cases/game-record/COVERAGE.md`

# 我的战绩视觉回归

从「我的 → 我的战绩」进入真实部署的 H5 页面。新旧版分别通过战绩版本接口和
持久化版本键选择；每例使用独立 mitmproxy 进程，仅对当前登录账号及
`visual-record-*` 记录提供数据，不创建真实牌局或修改线上战绩。

| 范围 | 覆盖 |
| --- | --- |
| 页面矩阵 | 新旧版 × 桌面 1440×900／手机 375×812 × 简中／繁中／英文 |
| 初始状态 | 接口等待中的加载、加载完成后的空态、有数据列表、列表底部与末页提示；新版 23 条长列表断言真实滚动与末条进入视口 |
| 记录展示 | 德州／短牌／拼三张；私人房／俱乐部／大厅；金币／筹码；正／负／零积分，大额小数、符合建房 20 加权单位上限的房间名、同日与跨日日期分组 |
| 选择汇总 | 未选择、未开局单选及混选、选择盈利、取消选择后选择亏损、全选、清空、退出选择；断言实际汇总值 |
| 删除 | 真实触摸侧滑、删除确认、取消、未结束牌局不能删除；旧版额外覆盖删除成功与接口失败，核对代理删除列表与 UI |
| 概览 | 私人房、俱乐部、大厅、短牌、未开局；自己与对手的输赢明细展开、切换、收起 |
| 牌谱详情 | 德州与拼三张的操作记录和结算；卡牌、底池、玩家积分来自固定接口数据 |
| 回放 | 正／负／零收益的回放列表，以及未开局的回放空态 |
| 分页 | 旧版第二页等待中的加载及追加完成后的末页；初始数据 23 条；删除状态跨模式保留，旧版删除成功后分页 20＋2 条，无丢失或重复 |
| 错误 | 新版列表接口失败、点击重试恢复、详情接口失败；旧版删除接口失败 |
| 导航 | 列表、概览、牌谱的往返；旧版重新进入列表再次加载 |

每种语言有 32 张旧版、30 张新版状态截图，各覆盖两种视口，共 372 张新增基准。
两套用例都纳入 push 的 `core`，每日任务覆盖三种语言。原钱包模块的真实账号空态
用例继续保留。

## 数据与隔离

- `mitmproxy/data.py` 生成固定记录、房间、玩家、结算、牌谱及回放响应。房名按建房界面的 UTF-16 加权计数规则（ASCII 为 1、其他字符单元为 2）校验，上限为 20。
- `mitmproxy/addon.py` 的控制接口需要仅供测试进程持有的随机 token；浏览器不接触控制 token。
- 代理只处理 staging host；其他账号、非 fixture 房间／会话／玩家及含未知 ID 的混合批次均透传。本人和虚拟对手的混合资料批次先查询真实本人，再补入虚拟对手；本人资料不再由夹具替换。
- 节点列表和战绩版本只覆盖真实成功响应的必要字段；真实错误及 API 结构变化保留。选中节点的健康检查、一般 CORS 预检透传，不再全局短路所有 staging 预检。
- 加载状态通过控制接口暂停和释放响应，不依赖固定延迟；每例核对请求计数，确认数据经过代理。
- 重入列表前等待旧列表卸载；新版长列表加载后先滚动，随虚拟列表内容高度更新继续滚动，确认 23 条记录齐全和末条进入视口后再截取底部，避免导航及分批渲染竞态。
- 旧版分页加载截图先核对首批 20 条均已挂载、末条进入视口；追加完成后核对 22 条和最终末条进入视口，避免一次滚动停在尚未完整渲染的列表高度。首批、追加后的旧版列表以及新版 23 条列表均逐项核对完整房名序列，验证日期分组顺序及每条记录齐全、唯一，防止数量相同的重复或缺失。
- 代理刻意挂起列表响应期间，测试暂停该请求的 XHR 超时，避免慢速 Linux 截图触发应用的 10 秒截止时间；其余请求保留原有超时。正常状态截图前后都检查没有错误弹窗遮挡。
- 数据和错误只作用于本轮测试；进程停止后删除临时 CA，不保存 flow 或请求正文。
- App 其他页面仍使用既有浏览器网络稳定化；战绩及其俱乐部资料由 mitmproxy 提供。
- 新版列表错误返回 HTTP 503；删除与详情错误返回后端约定的 `ok: false` 业务错误，断言实际提示文案，避免旧版自动节点切换影响基准。

## 当前应用限制

本次测试以当前已部署 UI 为基准，应用显示问题留到后续源码修复。
新旧版列表侧滑展开时，日期与记录前景一起向左移动，桌面首条日期会在左侧边界被裁切。
`swipe_delete`、`delete_confirm`、`delete_cancel` 等基准保留当前展开状态，
不通过隐藏日期、关闭侧滑行或改写图片掩盖这个已知问题。
后续修复应用日期布局时，应重新生成并审查受影响基准。

新版 controller 没有分页 API，删除接口也未实现，确认删除后实际显示「不能删除」；
测试记录这一行为，不模拟删除成功。H5 的 React Native RefreshControl 没有可操作的
下拉刷新实现，因此只测试重新进入页面的数据加载，不把它称为下拉刷新覆盖。
旧版当前不显示末页提示，分页用第二页加载完成、完整记录序列及末条进入视口作为断言；新版另有末页提示截图。
新版短牌的牌谱容器尚不支持该玩法，因此只覆盖短牌概览。
原生 iOS／Android 刷新手势、回放牌桌播放控制、分享以及已下线的 Egret 玩法不在这套 H5 测试范围。

未开局记录同时出现在正常列表中，接口不伪造结算分数；单选、与亏损记录混选以及全选均断言实际汇总值。
旧版缺分记录污染汇总的 `NaN` 问题与布局修复一起纳入下述应用 PR。
新旧版长房名与时间布局由独立应用 PR [laiwan_react_native #6996](https://github.com/kevinanew/laiwan_react_native/pull/6996) 修复。
该补丁用真实 React Native Web 组件验证新旧版、双视口及短名、普通名、两种合法边界名、历史超长名，共 20 组浏览器检查；合法 20 个宽字符也可复现旧版手机标签溢出。
这套接口回归使用正常建房可生成的 20 单位边界名；历史超长名只用于应用补丁的额外压力验证。

## 运行

```bash
cd visual
# Linux 生成三语言基准
VISUAL_FILTER='signed_in_game_records_(legacy|v2)$' VISUAL_SUITE=app pnpm run reference
# 独立对比三语言基准
VISUAL_FILTER='signed_in_game_records_(legacy|v2)$' VISUAL_SUITE=app pnpm run test:all
```

只选战绩的 `reference` 会重写每张所选基准，避免像素占比较低但语义不同的滚动位置
被对比容差保留；普通 `test` 的对比容差不变。

机器上并发运行其他应用用例时，可用 `VISUAL_USERNAME=laiwanvisualrecords01` 为这轮
战绩测试选择独立账号；密码沿用现有测试配置，通过真实 UI 登录。账号需预先通过
仓库现有的 staging 测试注册接口创建，避免普通注册的 IP 限额。

```bash
e2e/.venv/bin/python -m unittest discover -s visual/cases/game-record/mitmproxy -v
```

## 验证记录

2026-10-09：[GitHub Linux 基准生成](https://github.com/kevinanew/clrn/actions/runs/37811806109)
完成三语言的 12 个场景、372 张截图，全部首轮通过，没有重试；同轮 9 项代理自测和
29 项浏览器辅助检查通过。整合最新 master 后，64 项场景与基准完整性检查、
TypeScript 类型检查和 lint 均通过。

修复虚拟列表滚动等待后，[源修复 CI](https://github.com/kevinanew/clrn/actions/runs/37820913205)
的 44 个 App 核心场景全部首轮通过，没有重试；34 项辅助检查与 9 项代理自测也通过。
两轮分页基准生成（[完整分页](https://github.com/kevinanew/clrn/actions/runs/37820933372)、
[强制重写繁中任务](https://github.com/kevinanew/clrn/actions/runs/37824596468)）提供了正确底部位置的图片。
复核后仅替换四张繁中分页截图，其余 368 张战绩基准保持不变，总数仍为 372。

最终完整三语言对比（[12 个场景](https://github.com/kevinanew/clrn/actions/runs/37833629243)）
与 [CI](https://github.com/kevinanew/clrn/actions/runs/37833597209) 均通过，无重试。
372 张原图的独立视觉审查完成：369 张初审通过，3 张侧滑日期裁切经独立复核确认，
因此绝对视觉质量审查结论为 `REJECTED`，不将其表述为全量视觉无问题。
涉及英文桌面新版 `delete_cancel`、简中桌面旧版 `delete_cancel` 和 `delete_confirm`。
本轮按现有 UI 补充测试，将该应用显示问题保留为上述后续修复项；截图对比通过表示
测试忠实记录当前界面。


### Android 动画交集与原生独有差异

# Android 动画视觉回归清单

本清单对应固定 Staging Release `android-staging-7304-856f052cfdd8`，应用提交 `856f052cfdd8cfd7f95cc5f5cecb783aa871279d`，在 API 35、x86_64、720×1280、英文模拟器上运行。新版 APK 的 16 个动画 WebP 已与原基准逐字节复核。三种语言的普通页面截图仍由原有场景覆盖；动画轨迹只采集一次英文版。新增动画时，要在对应场景加入真实触发、可见运动断言和关键帧基准，再运行 `compare`。

| 动画 | 原生测试入口 | 关键帧或素材验证 |
| --- | --- | --- |
| 启动插画、测试版提示出现 | `animation-transitions.spec.ts` 启动场景 | `native-launch-artwork-visible` 确认应用插画可见；`native-launch-and-staging-notice` 起点、中途、终点及区域变化 |
| 通用水平导航入栈、出栈 | `animation-transitions.spec.ts` 账号安全 | `native-stack-enter/exit` |
| 搜索确认弹窗入场、退场 | `animation-transitions.spec.ts` 游客搜索 | `search-confirmation-enter/exit` |
| 大厅老虎机横幅轮转 | `slot-animation.spec.ts` 登录大厅 | `hall-slot-banner` 两个运动相位及循环运动断言 |
| 大厅匹配转圈 | `animation-transitions.spec.ts` 匹配等待 | `hall-matching-spinner` 两个相位；颜色分布对比允许任意转角，独立断言位置运动 |
| 俱乐部更多菜单、房间空态淡入 | `animation-transitions.spec.ts` 俱乐部 | `club-more-enter/exit`、`club-rooms-empty-enter` |
| 俱乐部列表骨架脉动 | `club-skeleton-animation.spec.ts` 挂起真实列表响应 | `club-list-skeleton` 两个控件各自的明暗相位 |
| 私人房玩法选择器、邀请好友抽屉 | `animation-transitions.spec.ts` 私人房 | `game-picker-enter/exit`、`invite-friends-enter/exit` |
| 完整老虎机弹层、三滚轮、三种奖励、能量不足提示 | `slot-animation.spec.ts` 真实旋转 RPC | `slot-popup-enter/exit`、`slot-{coin,currency_diamond,energy}-reels`、`slot-no-energy-enter/exit`；三个滚轮分别运动 |
| 德州、拼三张开局前菜单及面板 | `games.spec.ts` 两种 `_pre_game` 场景 | 各玩法的菜单、牌型、主题、设置、带入、续费、排行榜、牌谱、聊天、申请面板入退场 |
| 拼三张九个空座引导箭头 | `games.spec.ts` 拼三张开局前 | `zhajinhua-seat-guides-1..9` 各自两个运动相位 |
| 德州公共牌、操作按钮和玩家操作 | `games.spec.ts` 德州 `_game` | 翻牌、转牌、河牌、操作按钮 `zoomInDown`、跟注、加注、看牌、弃牌关键帧及牌面、下注语义断言 |
| 德州倒计时、加注面板与滑块、全压火焰、摊牌、结算与胜利光效 | `games.spec.ts` 德州 `_game` | `texas-operation-countdown`、`texas-holdem-raise-bet`、真实拖动的 `texas-raise-slider`、`texas-all-in-fire`、`texas-showdown`、`texas-settlement` |
| 德州玩家资料、举报、升级 | `games.spec.ts` 德州 `_game` 和 `_hall` | 资料与举报面板入退场；自动消失的 `texas-holdem-level-up` 出现、倒计时变化及恢复 |
| 德州语音、系统提示、弹幕、聊天举报/屏蔽、带入审核 | `games.spec.ts` 德州 `_panels` | `texas-holdem-voice`、`texas-system-prompt`、`texas-barrage`、聊天及审核面板关键帧 |
| 德州操作失败、余额不足、身份失效提示 | `games.spec.ts` 德州 `_panel_variants` | `texas-alert-retry/balance` 入退场、`texas-alert-auth` 入场；分别由真实错误响应触发 |
| 德州自动补充带入、合谋举报、个人排行榜、加载转圈 | `games.spec.ts` 德州 `_hall` | 对应面板入退场、`texas-loading-spinner` 两个区域各自运动 |
| 德州下一手预测 | `games.spec.ts` 德州 `_hall` | 预测面板和结果保留静态截图；此固定包的菜单未显示预测记录入口，无法触发记录弹层动画 |
| 拼三张倒计时、发牌、翻牌、操作按钮、快捷加注、精确加注 | `games.spec.ts` 拼三张 `_game` | `zhajinhua-operation-countdown`、`zhajinhua-deal-cards`、`zhajinhua-flip-cards`、操作按钮 `zoomInDown`、`zhajinhua-quick-raise`、精确加注入退场 |
| 拼三张比牌目标、摊牌胜利光效、升级 | `games.spec.ts` 拼三张 `_game` | 四个目标各自闪烁；同一次摊牌事件验证 `zhajinhua-showdown-cards` 和 `zhajinhua-victory`；自动消失的升级提示验证出现、倒计时与恢复。结算事件只更新被牌型覆盖的余额语义，保留静态结算截图和余额断言 |
| 拼三张游戏规则弹层 | `games.spec.ts` 拼三张 `_pre_game` 菜单入口 | `zhajinhua-game-rule-enter/exit` |
| 两种牌桌的七种表情和七种道具 | 两种 `_game` 场景 | 每种效果各自的播放首帧、变化帧；道具另检查飞行区；`animation-assets.json` 逐字节锁定全部 16 个 WebP 的帧数、顺序和时长 |

所有转场基准保存真实屏幕的起点、中途和终点，并检查触发前后确有可见变化。循环动画要求原生连续帧内发生运动，同时保存两个实际相位。普通页面截图不替代这些检查。`reference` 仅产生待审查候选图；提交基准后必须在 `compare` 模式验证。

水桶道具飞行峰值有两张经原生录屏审查的位置锚点；对比时仍使用相同的色差上限，允许采样落在任一真实播放相位。

拼三张带入审核面板的录屏还保存了遮罩先变暗、面板随后绘出的真实中途相位；两个相位均沿用同一色差上限。排行榜入场前要等待房间重连提示消失，起点才对应稳定牌桌。

德州精确加注退场、摊牌和自动带入的入退场使用原生录屏，以取得短于截图轮询间隔的中途相位。错误弹窗基准中的左侧玩家倒计时统一使用实际 100 像素遮罩范围；弹窗主体和其他牌面仍逐像素比较。

德州玩家动作标签的录屏区域位于头像倒计时右侧，不使用动态遮罩；首、中、尾基准从已审查的原生截图对应区域逐像素裁出。小型标签的中途帧变化门槛按该标签的实际首尾色差计算，画面仍需匹配中途基准。

网页专用的分享链接确认弹窗使用 `.web.js`，Android 版调用系统分享界面，因此不计入 Android 应用内动画。Android 系统分享界面的外观由系统版本控制。

固定 Staging 包在 `LaunchBranding` 挂载时同步打开不透明提示框，文字的 500 毫秒淡入被提示框遮住，无法在这个包上取得可见像素轨迹。启动场景只声明实际可见的插画和提示出现；若应用将提示延后或提供可测试的无提示启动入口，应为品牌淡入另加逐帧基准。

源码中 `TreasureBox` 只有导出而无页面消费，`PrizeCoinAnimation` 没有调用入口，不能把直接挂载组件产生的图片当作应用视觉回归。德州 `RTCPanel` 的首次初始化依赖尚未挂载的面板 ref，正常 UI 无法打开；这些效果需要应用先提供可达入口。旧引擎房间骨架同样不在固定 React Native 引擎包的可达路径内。

旧版快速匹配页的 `MatchGameBackgroundV2` 气球循环虽然有导航路由，当前大厅的旧版快速匹配内容分支已注释，固定包中没有可操作入口。拼三张的旧 `RaiseBetPopup` 只调用 `hide()`，没有 `show()` 调用；可见牌桌使用快捷加注与精确加注弹层，其动画已覆盖。房间设置的 `StepSlider.native` 没有开启 `animateTransitions`，调整值时不执行源码中的 `StepIndicator` 动画。

德州预测记录弹层虽然在源码中实现，但本包的菜单选项在 `DrawerMenu` 首次计算时未包含该项；牌桌出现预测按钮后，已显示的菜单选项没有重新计算。真实模拟器菜单截图只有排名、主题、设置、反馈、带入和退出。应用修复入口后再增加该弹层的入退场基线。

## 原生视觉与动画映射补全（执行仍待验证）

共享清单提供 89 个流程/258 个状态，两个独立启动测试补齐 `launch_staging_notice` 与 `launch_branding`，得到 Web mobile 的 **91 个流程、260 个状态/语言**。`ios/full/web-visual-map.ts` 将每个源状态关联到实际注册的测试；契约对三语言分别核对精确状态集合及 Playwright 收集结果。英文 `signed_in_texas_hall/level_up` 由原生升级提示的出现、倒计时、消失关键帧替代同名静态图，因此英文是 **259 个静态状态 + 1 个动画状态**，不能称为 260 张静态图。其他语言保留该静态状态。

`docs/web-coverage-source.json` 中 21 个 Web 动画标题均列出原生测试、语言和平台差异，收集契约拒绝缺失入口或预期跳过。新增 `web-animation-parity.spec.ts` 补齐简体中文游客搜索文案及开关/重开动画、大厅匹配面板入场、品牌固定位置像素的渐进淡入，以及实际 iOS 系统分享面板进退场。已有匹配旋转循环仍独立比较。分享测试检查 Copy 和系统分享目标选项并取消，不触发对外发送；Web 复制链接确认框是浏览器专属，不在 iOS 伪造该对话框。

原生动画保留 MP4、真实编码时戳、起点/终点及中间帧。品牌淡入采用同一位置像素的透明混合拟合，要求两个逐渐变清晰的中间相位，拒绝静止终态、突然跳变或全屏闪光；不把 DOM/CSS opacity 或浏览器虚拟时钟强加给 UIKit。**以上补充目前只通过 TypeScript、纯算法测试和实际测试收集，尚无新增四例的模拟器运行结果。** 若 Release 缺少原生品牌标识或系统分享入口，用例会明确失败，不会跳过或退回仅检查文件存在。
