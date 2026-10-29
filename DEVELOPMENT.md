# 本地提交前检查

本仓库使用 Python 的 [pre-commit](https://pre-commit.com/) 管理 Git hook，配置在根目录
`.pre-commit-config.yaml`。本地和两个现有 GitHub Actions 工作流执行同一份配置。

## 依赖与首次安装

使用 Git、Node.js **24.x**、npm **11.x**、CPython **3.12.x**，pre-commit 固定为 **4.3.0**
（`requirements-dev.txt`）。CI 也固定 Python 3.12 和 Node 24 系列；补丁版本随其安全更新。
不需要 uv，也不依赖全局 Python 包。以下命令用于 macOS/Linux，在仓库根目录执行：

```sh
npm ci
python3.12 -m venv .venv-pre-commit
. .venv-pre-commit/bin/activate
python -m pip install -r requirements-dev.txt
pre-commit --version  # pre-commit 4.3.0
pre-commit install
pre-commit run --all-files
```

Git 不会把本地 hook 复制到新克隆；每次克隆都要安装。虚拟环境应保留在当前绝对路径；
移动目录或重建环境后重新执行 `pre-commit install`。每个开发终端先激活此环境，
确保 `python3` 指向 Python 3.12，且 Node/npm 位于 PATH。

## 检查范围与执行方式

| Hook | 触发文件 | 执行命令 |
| --- | --- | --- |
| `typecheck` | JS/TS（含 c/m 前缀、JSX/TSX）、JSON、根 pre-commit 配置、Actions 工作流 | `npm run typecheck` |
| `python-static` | Python、任意目录的 `requirements*.txt`、根 package/lock、pre-commit 配置、Actions 工作流 | `npm run check:python:static` |

两个 hook 都用 `language: system`，复用当前 npm/Python 环境，不下载单独的 hook 环境；
`pass_filenames: false`、`require_serial: true` 确保每个匹配的全项目检查只执行一次。
仅改 Markdown、PNG 或 MP4 时没有匹配的 hook；手动 `--all-files` 会检查全仓库。
TypeScript 的实际源码范围由现有 `tsconfig.json` 决定。

原有 `check:python` 没有静态子步骤：它运行各目录的 Python 单元测试和真实 mitmproxy
集成测试，需要代理依赖并监听本地端口。因此新增独立的静态入口，完整 `check:python`
先调用它，再原样执行这些测试。静态入口用标准库 `compile` 在内存中检查 Git 跟踪的全部
Python 文件；支持编码声明，不导入/执行源码、不生成 `__pycache__`/`.pyc`，不检查未跟踪及
忽略文件，已删除文件不再读取。这只是语法检查，不是 Ruff、类型检查或测试运行。

Git 提交时 pre-commit 临时保存未暂存的跟踪文件差异，只检查暂存内容，结束后恢复；
手动 `--all-files` 则检查当前工作文件。新增文件须先 `git add` 才纳入检查。
两个 hook 都只检查，不自动修复、不启动设备、不连接 Staging、不分配账号、不操作系统代理。
浏览器截图、Android/iOS 设备和模拟器测试继续留在完整测试流程中。

## 失败、手动检查、升级和卸载

失败会保留 tsc/Python 的原始文件名、行号和错误，hook 返回非零并阻止 Git 提交。
按错误修改源码，检查 `git diff` 与 `git diff --cached`，仅重新暂存要提交的修改后重试。
本仓库没有自动修复命令；可直接运行下列命令诊断，避免用跳过 hook 作为修复：

```sh
npm run typecheck
npm run check:python:static
pre-commit run --all-files
```

找不到 npm/tsc 时检查 Node 24、PATH 和 `npm ci`；找不到 Python 时激活上面的环境；
pre-commit 提示配置尚未暂存时，审查后暂存 `.pre-commit-config.yaml`。
部分暂存失败后先核对工作区与暂存区；pre-commit 报告的临时 patch 路径可用于恢复排查，
不要使用 reset 或删除工作目录来处理检查失败。CI 不依赖开发者是否安装或跳过了本地 hook。

升级时修改 `requirements-dev.txt` 中的精确版本，必要时同步配置中的最低版本，重新安装，
执行全部 hook、下列回归和原有完整检查，并审查 CI。当前仅使用 local hooks，
`pre-commit autoupdate` 不会升级框架或 npm/Python 检查规则。

卸载执行 `pre-commit uninstall`；随后可 `deactivate` 并删除 `.venv-pre-commit/`。
已有其他 hook 时，安装器会使用迁移模式保留它；卸载会恢复原 hook，不要手工覆盖 `.git/hooks`。

## 回归验证与完整门禁

安装依赖后运行：

```sh
.venv-pre-commit/bin/python scripts/test-pre-commit.py
npm run check
python3.12 -m venv e2e/.venv
e2e/.venv/bin/python -m pip install -r e2e/mitmproxy/requirements.txt
npm run check:python
```

hook 回归在自行新建的独立临时 Git 仓库中安装 hook 并执行真实 `git commit`；夹具拥有独立
`.git`，没有远端，仅配置自己的测试身份，不修改当前项目仓库的 HEAD、暂存区、Git 配置或 hooks。
使用真实 tsc 和同一静态检查器，验证 TS/Python 错误阻止提交且 HEAD 不变、修复后提交成功、
提交树恰好等于原暂存内容、文件触发范围、部分暂存成功/失败时未暂存修改的恢复、暂存区及
工作文件不被改写、无字节码生成。夹具和自己的 pre-commit 缓存在测试结束时清理。
两个 CI 工作流均运行 hook 和这组回归，且保留原有完整检查与设备门禁。
`npm run check` 的原生用例收集仅验证登记与加载，不代表模拟器或真实设备运行通过。
