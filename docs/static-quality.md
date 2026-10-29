# 测试复杂度与架构门禁

本门禁对应 #25，只执行本地静态分析和临时负例，不访问业务网络、不启动设备、不修改源码或视觉基准。工具的临时 JSON 报告在系统临时目录生成并清理，最终结果输出到 stdout。原有类型检查、单元测试、原生用例收集、截图和录像门禁继续保留；收集成功不代表真实设备运行通过。

## 入口和依赖

使用 Node.js 24、Python 3.12。JS 工具及传递依赖固定在 package-lock.json，Python Ruff 固定在代理 requirements 中。

```sh
npm ci
python3 -m venv e2e/.venv
e2e/.venv/bin/python -m pip install -r e2e/mitmproxy/requirements.txt
npm run check:all
```

- `npm run check:static`：ESLint、dependency-cruiser、jscpd 和六组临时静态负例。
- `npm run check`：上述门禁，然后执行既有 typecheck、test:unit、test:ios:collect。
- `npm run check:python`：Ruff、Python 临时负例，然后执行全部既有代理单测和观察器集成测试。
- `npm run check:all`：统一调用 check 和 check:python；#17 的 pre-commit 可复用此入口，本任务不安装 hook。
- `npm run measure:quality`：输出当前源码的完整测量 JSON，不更新迁移清单。

`ios-simulator.yml/check` 执行 check；`ios-full.yml/proxy-check` 执行 check:static 和 check:python，仍是 native 和截图录像汇总门禁的前置条件。两个检查 job 读取完整 Git 历史，并将 PR base SHA / push 前一 SHA 传给 `QUALITY_BASE_SHA`，防止在同一 PR 内扩大迁移清单。本地默认比较 HEAD 已提交清单；首次引入时基准提交还没有 quality 目录，初始清单须按下述基线审查。

## 实测与最终阈值

初始源树为 `026e21ecd6ac31edcd66d55eb44323cee39ea8f1`，先复制该提交到临时目录测量，再接入门禁。固定版本及结果存于 [measurement.json](../quality/measurement.json)，精确位置和原因存于 [legacy.json](../quality/legacy.json)。

| 项目 | 版本 / 配置 | 初始结果 |
| --- | --- | --- |
| ESLint / TS parser | 10.12.0 / 8.71.1，classic complexity 10、max-depth 3 | 307 文件均可解析，4108 个函数；109 个函数超限，最高 107；73 处块嵌套超限，最高 6 |
| Ruff C901 | 0.15.12，复杂度 10 | 40 文件均可解析，292 个函数；13 个超限，最高 44 |
| dependency-cruiser | 17.3.9，含 type-only 依赖 | 1 个循环、2 条跨层依赖；无未解析依赖 |
| TypeScript 网络伪造 | ESLint AST 规则 | 29 个 route/fulfill 调用、2 个响应适配器方法定义 |
| jscpd | 5.1.2，mild，至少 5 行且 70 tokens | 42 组重复、479 重复行；其中 JS 8 组、TS 15 组、Python 19 组 |

10/3/10 是本次按完整测量确定的增量门槛。保留历史违规，避免为降低数字机械拆分函数或改变测试覆盖。jscpd 的 70 tokens / 5 行用于识别有意义的重复片段，不使用全库重复率阈值；缩短其他文件不能抵销新增重复。输入为全部 307 JS/TS 与 40 Python 文件，其中 5 个极短 TS 文件低于 jscpd 的最小 token 数，工具统计 342 个可比较文件。数据 JSON、PNG、录像、Swift 辅助程序不冒充 JS/TS/Python 源码参与这些指标；行数只作工具统计。

复测初始源树（临时目录名须未被使用）：

```sh
mkdir /tmp/clrn-pg-25-baseline
git archive 026e21ecd6ac31edcd66d55eb44323cee39ea8f1 | tar -x -C /tmp/clrn-pg-25-baseline
ln -s "$PWD/node_modules" /tmp/clrn-pg-25-baseline/node_modules
node scripts/measure-quality.mjs /tmp/clrn-pg-25-baseline > /tmp/clrn-pg-25-measurement.json
```

测量入口使用 ESLint complexity/max-depth 的零阈值与 Ruff `lint.mccabe.max-complexity=0` 获取实际值；生产门禁仍使用配置中的 10/3/10。扫描器读取各工具的 JSON，解析错误、工具缺失、异常退出均失败，不能计为零违规。

## 分层与网络伪造

普通视觉、集成、功能测试和 UI 操作层不得新增 JS/TS 响应伪造。ESLint 按 AST 检查 `route`、`routeFromHAR`、`fulfill` 方法调用和方法实现，包括静态方括号、可选链以及直接赋值/解构得到的调用别名。注释、字符串和普通数据属性不会命中。规则是保守的语法门禁，无法证明所有动态属性或运行时封装的含义，仍需代码审查。

dependency-cruiser 检查所有本地 JS/TS 导入（含重导出及 type-only），禁止循环、未解析依赖，以及对三个响应实现的直接导入：`visual/src/support/networkMocks.ts`、`ios/full/network-routes.ts`、`scripts/account-network-fixture.mjs`。该规则对普通测试、UI 文件和新增中间辅助模块均生效。代理控制客户端可被 UI 层使用；它不在这里实现响应内容。

仅精确允许以下代理适配器单元测试使用上述方法及导入响应实现；复杂度和重复检查仍生效：

- `ios/full/network-routes.test.mjs`：验证原生响应桥复用夹具及上游透传。
- `ios/full/network-observer.test.ts`：验证响应桥与 mitmproxy 观察器的适配契约。

普通 `*.spec.ts` 和其他 `*.test.*` 没有网络例外。Python 协议代理、代理单测、测试数据文件和生成物分别处理；未宽泛排除测试目录。源文件枚举只排除依赖、虚拟环境、Appium 安装目录、Git/cache、运行产物和报告目录，所有源码及本门禁自身继续受复杂度和重复规则约束。

## 迁移清单与审查

初始清单共 271 项：ESLint 213、Ruff 13、依赖 3、重复 42。每项都有原因。JS/Python 使用文件、行列、规则、诊断和该行源码 SHA-256；依赖使用规则、源/目标及完整循环路径；重复使用两侧行列/字符位置、token/行数及片段 SHA-256。新增违规失败，旧项消失也会提示删除失效条目。清单比较包含具体内容，不能用“某文件允许 N 个错误”给新违规腾额度。

修复历史问题后，手动删除对应条目，再运行检查。此清单故意严格：移动历史违规位置或修改诊断也不获得新例外，需在该次变更中消除违规。没有自动重建/扩大清单的命令；不得添加新例外、全局关闭规则、排除整个测试目录或删除原有断言。`assertShrinking` 还会比较已提交的清单，只允许保留完全相同的违规或删除。仅修改原因文字不改变违规身份。

规则配置、阈值、扫描范围、网络单测例外、检查脚本、CI 入口的变更必须在代码审查中说明原因、前后测量及负例结果；不得通过禁用规则解决失败。ESLint 内联配置禁止生效，Ruff 使用 `--ignore-noqa`；源码内的 jscpd 忽略区块标记直接失败，避免新增重复被静默隐藏。若新增响应实现模块，审查时同时更新分层规则的实现路径；AST 门禁继续阻断新增 TS 伪造入口。

`quality/static.test.mjs` 与 `quality/python.test.mjs` 在临时目录构造复杂函数、过深嵌套、循环、越层导入（含 type-only）、未解析导入、非法 Mock 和新增重复；还验证已有重复的第三份拷贝、合法单测、数据文本、清单扩张/移动/变更、解析错误、ESLint 内联禁用以及行级/文件级 noqa。静态负例放在 `.cache/worktree` 路径，覆盖宿主工作树布局下的绝对报告路径。它们只解析样例，不执行样例代码，不运行设备或业务网络。

工具定义参见 [ESLint complexity](https://eslint.org/docs/latest/rules/complexity)、[max-depth](https://eslint.org/docs/latest/rules/max-depth)、[Ruff C901](https://docs.astral.sh/ruff/rules/complex-structure/)、[dependency-cruiser](https://github.com/sverweij/dependency-cruiser) 和 [jscpd](https://github.com/kucherenko/jscpd)。

## 本轮本地验证（2026-10-29）

在 Node.js 24.14.0 / Python 3.12.0 下，`npm ci`、虚拟环境创建及 requirements 安装成功。按上述临时副本命令重测原始提交，文件数、复杂度/嵌套统计、依赖违规及重复报告与保存的初始记录一致。当前树的 `check:static`、Ruff 门禁、六组 JS 静态负例和两组 Python 负例通过，无新增违规；类型检查通过。独立执行 `test:ios:collect` 收集到 13 个文件、184 项测试，仅证明用例可收集。

完整 `npm run check` **未通过**：499 项原有 JS 单测中 479 项通过，20 项在监听 `127.0.0.1` 时被沙箱以 `EPERM` 拒绝。完整 `npm run check:python` **未通过**：第一目录 26 项通过，下一目录的 15 项中有一项本地 HTTP 集成测试在 `bind` 时触发 `PermissionError`，因此后续目录及观察器集成测试尚未执行。保留原有检查和断言，交由宿主在允许本地端口的环境运行全部固定检查。本轮没有原生设备运行、新提交 CI、截图或录像通过证据。
