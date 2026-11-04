# iOS 失败分片优先调度

`ios-full.yml` 在当前提交上先验证最近一次同 PR/分支、同 workflow 的未成功分片，
通过后再运行本轮剩余分片。历史结果只决定顺序，不替代当前提交的任何检查。

流程为 `plan + proxy-check → target-build → native-priority → native → screenshot-video-gate`。
没有优先项时跳过 `native-priority`，由 `native` 执行完整计划；没有剩余项时只运行优先阶段。
`native` 的显式 `needs` 和条件保证优先阶段失败、取消或意外跳过后，剩余重型任务不会提交执行。
两阶段各自保留 `max-parallel: 10`，互不重叠。

独立的 `ios-simulator.yml` 继续执行现有静态检查及游客页面/动画回归。它只有一个重型
`simulator` job，没有可延后的其他分片；不与完整回归混用历史或减少其覆盖。

## 历史、分片身份与回退

每轮 `plan` 在启动原生任务前上传 `ios-ci-plan-<attempt>`，保留 30 天。
其中记录完整矩阵、优先和剩余清单、配置指纹、PR/分支/workflow 范围及运行 ID/提交身份。
即使只执行了少数优先项，完整清单仍可用于下一轮修复，不会把未放行项丢掉。

历史查询使用 `actions: read`，仅选择早于本次运行的最近一轮同范围运行。
PR 还匹配编号、head 仓库、base 仓库及目标分支；push 按分支隔离，手动运行不混入自动事件。
最近一轮尚未结束时回退全量，不越过它取更旧结果。

稳定分片身份为 `(group, locale, shard)`，同时校验名称、过滤器、Playwright 分片、模式等
完整计划字段及调度配置指纹。账号按 run ID 轮转，不属于测试身份；执行仍使用本轮账号，
保留账号级 `concurrency` 独占锁、`queue: max`、专用模拟器和清理步骤。

以下情况都回退到**当前配置的完整计划**：无历史、API 查询失败、历史产物缺失或过期、
结果缺失/重名/未完成、配置不兼容、新增/删除/重命名分片或改变过滤器。
新增项不会从旧清单推导，因此不会漏检。旧工作流没有计划产物，首次上线也自然全量执行。

如果上轮优先阶段失败，只将其中仍未成功的项优先安排，其余项归入本轮剩余阶段。
如果优先阶段全部成功，则从上轮剩余阶段找出未成功项。
`failure`、`cancelled`、`skipped`、超时及其他非 `success` 结论均不算成功；缺失结果则全量回退。

## 构建、产物与门禁

`target-build` 每轮只下载一次部署记录指定的公开模拟器包，校验原有 Release 身份、
应用提交、大小与 SHA-256，再上传不可变的本轮产物。
两个阶段都下载这份产物并重新校验，不重新解析远端 Release。
各原生分片继续保存原有截图、录像、关键帧、报告、失败摘要和 `build-info.json`。
业务断言、测试范围、视觉阈值和重试次数保持原有配置。

汇总检查继续使用 **`iOS screenshot and video gate`**，静态检查继续叫 `proxy-check`，
各实际原生分片保留原有 `matrix.label`。汇总在依赖失败或跳过后仍执行，要求计划、
视觉基准预检、静态检查、目标包及每个有任务的阶段全部成功。
只有计划明确为空的阶段才允许 `skipped`；空的完整计划、缺少产物或应运行项跳过都阻断。
优先阶段成功不等于当前提交全量成功，不修改分支保护规则。

## 手动全量与同提交重跑

在 Actions 中手动执行 **iOS 完整回归**，始终忽略历史，完整运行所选范围。
要复现自动 PR 范围，选择 `group=pr`、`locale=all`、`mode=compare`，
`functional_case=all`，`animation_case` 留空。
其他手动业务组和诊断模式仍遵循原有选择规则。
手动诊断使用独立检查名称，不发布正式 PR 门禁上下文。

GitHub **Re-run failed jobs** 仍用于同一个提交；它不会实现新提交的失败优先调度。
成功依赖的原计划和目标包通过 job output 复用，避免要求它们在新的 attempt 重跑。
新提交查询历史时逐个读取各 attempt 的 job，保留未重跑成功项并采用重跑后的最新结果。
超过查询上限或无法可靠合并时安全回退全量。

## 观测与验证

计划和总门禁摘要显示历史来源、回退原因、两阶段清单和本轮阶段结果。
总门禁另外查询本轮 job，记录实际启动的原生任务数、job 创建至启动的等待、
创建运行至首次失败反馈、创建运行至全量原生成功的耗时。
等待包含依赖、账号锁及 runner 排队；运行耗时从原 run 创建计时，包含同次 run 的重跑。
只计算原生分片，不将门禁自身计入全量原生耗时；未全量成功时不记录成功总耗时。
观测 API 不可用会明确写入摘要，不改变门禁判断。

本地验证：

```sh
npm ci
node --test scripts/ci-schedule*.test.mjs scripts/animation-workflow.test.mjs
npm run check
```

调度测试包含实际 CLI、本地 HTTP API 和 ZIP 历史产物，覆盖 20 项中 3 项失败、
连续修复、API 不可用、计划变化、取消/跳过、失败重跑及 4096 种门禁阶段状态。
它们不连接 Staging、不启动模拟器、不触发 GitHub CI。

以下真实 PR 验收尚未完成，本地模拟和同提交重跑均不能代替：

1. 首轮全量，保存运行 URL、计划产物、启动数和上述时间观测。
2. 选择真实失败的少量分片，在新修复提交上确认先只启动对应项及必要依赖。
3. 优先仍失败时确认剩余项没有 runner 启动，总门禁失败且失败证据可下载。
4. 再修复后确认优先成功才启动剩余项，两阶段合计恰好覆盖当前完整计划且无重复。
5. 从 PR 检查页确认 required checks 仍使用原有名称，取消/跳过不能放行合并。
6. 分别比较失败反馈耗时与全量成功耗时；两阶段引入的等待可能延长成功总耗时，不能把更早失败反馈写成整体 CI 加速。

### 现有平台证据与未完成项（2026-11-05 只读复核）

[PR #35](https://github.com/appcookie/clrn-pg/pull/35) 的 head 为
`74af07372cca17f381ca7abb533b924a40407b49`，base 为
`b748cb566ae8ebf6e2c9d3c49dedbf882d5266f1`。
[分支运行列表](https://api.github.com/repos/appcookie/clrn-pg/actions/runs?branch=kevinanew/ci&per_page=100)
返回两条运行，其中完整回归只有 [run 41859632950](https://github.com/appcookie/clrn-pg/actions/runs/41859632950)，
另一条是独立模拟器回归，不能作为两阶段验收证据。
[plan 日志](https://github.com/appcookie/clrn-pg/actions/runs/41859632950/job/126677544121)
记录了 26 项当前矩阵：三语言游客 startup/pages 共 6 项，以及未隔离录屏 20 项。
完整计划产物为 [ios-ci-plan-1](https://github.com/appcookie/clrn-pg/actions/runs/41859632950/artifacts/13339970025)。

逐项核对 [attempt 1 jobs](https://api.github.com/repos/appcookie/clrn-pg/actions/runs/41859632950/attempts/1/jobs?per_page=100)
及 [attempt 2 jobs](https://api.github.com/repos/appcookie/clrn-pg/actions/runs/41859632950/attempts/2/jobs?per_page=100)，
各返回 31 条记录、完整覆盖上述 26 个分片名称；实际启动只统计有正数 `runner_id` 和启动时间的原生分片。

| 运行 | 优先阶段 | 原生分片执行情况 | 总门禁 |
| --- | --- | --- | --- |
| attempt 1 | `skipped`，未启动优先分片 | 实际启动 11 项：10 成功、1 失败；其余 15 项未分配 runner 即取消 | [failure](https://github.com/appcookie/clrn-pg/actions/runs/41859632950/job/126829506063) |
| attempt 2（同提交失败重跑） | `skipped`，未启动优先分片 | 复用 10 项原成功结果，新启动 16 项，最终 26 项均成功 | [success](https://github.com/appcookie/clrn-pg/actions/runs/41859632950/job/126883601019) |

attempt 2 API 也返回了复用成功项，不能把这 10 条记录算作再次启动；按名称、runner、启动和完成时间
核对两次 attempt，合计实际启动 27 次、覆盖 26 个唯一分片，其中 animation-13 失败后重跑一次。
以下时间均为 UTC，由运行和 jobs API 的原始时间计算，未使用会合并历史结果的门禁观测摘要：

| 观测 | 时间或耗时 |
| --- | --- |
| 原 run 创建 | 2026-11-04 15:37:12 |
| attempt 1 首个原生分片启动 | 17:06:18；距创建 5346 s |
| attempt 1 已启动分片的 job 创建至启动等待 | 平均 4868.7 s，最大 8334 s |
| 首次原生失败反馈（animation-13 完成） | 19:30:58；距创建 14026 s |
| attempt 2 开始 / 首个新执行分片启动 | 20:07:46 / 20:07:52 |
| attempt 2 新执行分片的 job 创建至启动等待 | 平均 947.8 s，最大 2341 s |
| 全量原生成功 / 总门禁成功 | 21:40:21 / 21:41:17；距原创建分别 21789 s / 21845 s |

上述 job 等待不包含 job 创建前的准备和依赖等待；从原 run 创建计算的耗时包含准备、排队及重跑间隔。
attempt 1 未全量成功，不能记录为成功总耗时；这些数据也没有同范围非空优先阶段的对照，不能据此声称反馈改善或全量加速。
两次门禁日志分别记录 `priority=skipped, remaining=abandoned` 和
`priority=skipped, remaining=success`，只支持全量回退及同提交失败重跑路径。
已核对总门禁仍发布 `iOS screenshot and video gate` 上下文；读取 master 的 required status checks
配置返回 HTTP 403（集成无权限），因此未验证分支保护实际要求的完整检查集合。

**验收仍未完成：[P2][本PR负责] 非空优先阶段失败阻断，以及后续新提交优先成功后完整、无重复放行的真实 PR 证据仍缺失。**
[Issue #34](https://github.com/appcookie/clrn-pg/issues/34) 的“本次范围”同时写明
“仅创建跟踪 issue；实施通过后续独立 PR 完成”，并限制本次不修改 workflow、不触发 CI、不调整分支保护。
补做上述平台实验需要新提交及真实 CI 运行，与此次仓库内修复及不提交、不推送的限制冲突。
本次只记录现有证据和缺口，保留全部实现、测试及上述验收要求；待允许开展真实 PR 实验时补齐第 2–6 步，不能将本条标为已通过。
