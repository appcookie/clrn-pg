# 三台 macOS runner 的 iOS CI

PR 和 master push 由 `ios-full.yml` 执行。公共静态检查、类型检查、单元测试、Playwright 清单收集、Python 检查、账号计划、compare 基准预检和公开 Release 校验集中在 `plan` Linux job。通过后只展开三个 macOS job；`proxy-check`、`check`、`simulator` 是保留旧检查名称的 Linux 兼容门禁，不重复安装或执行公共检查。`ios-simulator.yml` 只保留手动独立诊断。

| job | 自动执行的逻辑分组 | job timeout |
| --- | --- | --- |
| App | 三语言游客 pages/startup 六组；animation-1～8、10、17、24；原 Staging 六场景 smoke | 330 分钟 |
| 德州 | animation-11、13、18、19 | 210 分钟 |
| 拼三张 | animation-15、16、22、23、25（原 `zhajinhua` 业务） | 240 分钟 |

原自动范围的 26 个逻辑分组参数和原 Staging 命令均保留，不删重复用例；加上 Staging 共 27 组。五个隔离组仍见 [隔离清单](../ios/full/quarantined/README.md)，不计为通过。手动业务、语言、动画、隔离组和功能用例过滤仍由原账号计划器处理，再将选中的逻辑分组归入对应业务 runner；不会启动无关业务 runner。独立 Staging 仍可手动按页面和视觉模式执行。

每台 Mac 只执行一次 checkout、npm、Appium driver、ffmpeg、Python 和 Release 下载，创建一个专用 iPhone 16 / iOS 18.5 模拟器。每组使用独立测试进程。子进程退出时清除同一进程组的残留 Appium、代理和录屏进程；组间恢复系统代理、关闭并抹掉模拟器、删除附加的 `clrn-isolated-*` 模拟器。下一组准备失败时不能进入测试。清理或归档失败也记为该组失败。

每个业务 job 只持有一个公开账号，以 `ios-account-<username>` 的 job concurrency 跨运行互斥；不再在一个 job 内切换多个账号锁。公开账号由运行 ID 和固定业务偏移轮转，重跑保持稳定。只有一个或两个已就绪账号时，共享账号的业务 job 排队。各登录组执行前，在持锁范围内重新准备余额和房间；凭据通过私有临时文件注入该组进程，随后删除文件，游客和 Staging 不继承登录凭据。三台同时运行需要至少三个就绪账号。

固定输出目录在下一组执行前清空；清空前，各组将报告、截图、MP4、可浏览证据、构建身份、reference 候选和 `group.json` 归档到 `ios/artifacts/business/<business>/<group>-<locale>-<shard>/`。失败运行也归档；视频导出失败仍复制原始结果。业务产物名包含 business、run ID 和 attempt，保留 30 天。reference 目录是该组结束时的候选快照，包含仓库已有基准；候选未自动批准，审查时结合该组报告确认本轮实际生成的文件。

`results.json` 在测试启动前先记录 pending/running，随后记录每组 prepare、test、validate、cleanup、archive 的耗时与错误。失败后继续后续组，取消后剩余组标记 cancelled；任一 failed、cancelled、pending、running、skipped 或缺失组都不能通过。总门禁还核对完整业务计划、运行 ID、attempt 及逐组结果。小型状态产物按业务和 run ID 命名，业务重跑时覆盖；仅重跑失败 job 时允许复用同一运行较早 attempt 的成功业务结果，不接受其他运行或未来 attempt。完整证据仍按 attempt 分开保存。compare 失败仍沿用原缺基准诊断选择；仅采集候选时预检依然失败，不能冒充正式通过。手动诊断使用不同的检查名称。

## 本地验证范围

本次只执行相关测试，没有运行完整单元套件或模拟器回归：

```sh
node --import tsx --test scripts/ios-ci-business.test.mjs scripts/animation-workflow.test.mjs
node --import tsx --test scripts/ci-accounts.test.mjs ios/full/select-ci-matrix.test.mjs ios/full/baseline-preflight.test.mjs ios/full/animation-gate.test.mjs ios/full/screenshot-evidence.test.mjs ios/full/video-evidence.test.mjs
```

覆盖自动计划等价、三业务账号锁、手动定向、所有阶段失败后继续、取消/漏组阻断、进程树清理、凭据不跨组继承、Staging 六场景及证据不覆盖。另执行 ESLint、依赖及重复代码静态检查，未新增历史例外。工作流使用 actionlint 1.7.12 校验；该版本尚不识别仓库原有的 `concurrency.queue: max`，只忽略此字段的未知键诊断，保留账号排队语义。

## 实际 CI 验收待完成

按本次只跑相关测试的要求，没有触发完整 CI。尚不能据此确认真实模拟器环境复用或实际耗时，也未将 issue 的实测验收视为完成。

后续首轮自动回归的汇总摘要会记录每个业务 job 的创建至开始间隔、公共初始化、分组执行及归档、总执行时间和结论；每组细分耗时见 `results.json`。创建至开始间隔包含调度和账号锁等待，不能全部归为机器启动时间。请用真实运行填写下表，再核对 App 预计 207～252 分钟、德州 82～92 分钟、拼三张 114～134 分钟与 timeout 的余量；表内估算尚未验证。

| run / attempt | 业务 | 等待 | 初始化 | 测试及归档 | 总执行 | timeout 余量 |
| --- | --- | --- | --- | --- | --- | --- |
| 待实际运行 | App | 待测 | 待测 | 待测 | 待测 | 待测 |
| 待实际运行 | 德州 | 待测 | 待测 | 待测 | 待测 | 待测 |
| 待实际运行 | 拼三张 | 待测 | 待测 | 待测 | 待测 | 待测 |

GitHub 连接器读取 master 分支保护检查列表返回 403，本机 GitHub CLI 返回 404，未能确认管理配置；实现保留现有 `plan`、`proxy-check`、`check`、`simulator` 和 `iOS screenshot and video gate` 检查名，但仓库实际配置仍需有管理权限的维护者核对。

实际验收还需检查三台实际申请数、组间登录/语言/代理状态、失败组证据、跨运行账号排队，以及各业务产物的磁盘占用和上传时长。手动 `all` 或完整动画诊断的范围大于当前 PR 预算，仍受各 job timeout 限制；超时不能视为通过。
