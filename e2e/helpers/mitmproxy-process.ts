import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const STARTUP_TIMEOUT_MS = 90_000;
const STARTUP_POLL_MS = 100;
const SHUTDOWN_TIMEOUT_MS = 2_000;
const MAX_DIAGNOSTIC_LENGTH = 8_000;

/** 管理一个 mitmdump 进程，负责启动诊断、就绪检查和退出。 */
export class MitmdumpProcess {
  private startupError?: Error;
  private diagnostics = '';
  private readonly exited: Promise<void>;

  /**
   * 绑定代理子进程并开始收集启动诊断输出。
   * @param child - 已启动的代理子进程。
   */
  constructor(private readonly child: ChildProcess) {
    /**
     * 保留代理最近的标准输出和错误输出，用于启动失败诊断。
     * @param data - 子进程输出的数据块。
     */
    const captureOutput = (data: Buffer) => {
      this.diagnostics = (this.diagnostics + data.toString()).slice(-MAX_DIAGNOSTIC_LENGTH);
    };
    child.stdout?.on('data', captureOutput);
    child.stderr?.on('data', captureOutput);
    child.on('error', error => { this.startupError = error; });
    this.exited = new Promise(resolve => child.once('close', () => resolve()));
  }

  /** 判断代理子进程是否尚未退出或被信号结束。 */
  private get isRunning(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  /**
   * 轮询代理控制接口，进程提前退出或超过等待期限时报告启动失败。
   * @param checkStatus - 读取代理状态的异步探测函数。
   */
  async waitUntilReady(checkStatus: () => Promise<unknown>): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (true) {
      if (this.startupError || !this.isRunning) {
        const reason = this.startupError?.message || this.diagnostics;
        throw new Error(`mitmproxy 启动失败；请安装 e2e/mitmproxy/requirements.txt。\n${reason}`);
      }
      try {
        await checkStatus();
        return;
      } catch {
        if (Date.now() >= deadline) {
          throw new Error(`mitmproxy 启动超时。\n${this.diagnostics}`);
        }
        await delay(STARTUP_POLL_MS);
      }
    }
  }

  /** 终止代理并等待退出，超过清理期限后强制结束进程。 */
  async stop(): Promise<void> {
    if (this.isRunning) this.child.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.exited,
        new Promise<void>(resolve => { timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    if (this.isRunning) this.child.kill('SIGKILL');
    await this.exited;
  }
}

/**
 * 使用独立配置目录和控制凭据，在本机端口启动 mitmdump。
 * @param port - 本机代理监听端口。
 * @param directory - 代理独立配置与证书目录。
 * @param token - 仅用于测试接口或代理控制接口的认证凭据。
 * @param addonPath - 可选代理插件路径。
 * @param environment - 本轮代理的环境配置，原生适配器可传入专用夹具服务地址。
 */
export function startMitmdump(port: number, directory: string, token: string,
  addonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../mitmproxy/network_faults.py'),
  environment: NodeJS.ProcessEnv = process.env): MitmdumpProcess {
  const executable = process.env.MITMDUMP_PATH || process.env.E2E_MITMDUMP_PATH
    || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.venv/bin/mitmdump');
  const child = spawn(executable, [
    '--listen-host', '127.0.0.1',
    '--listen-port', String(port),
    '--set', `confdir=${directory}`,
    '--set', 'connection_strategy=lazy',
    '--set', 'flow_detail=0',
    '--set', 'termlog_verbosity=error',
    '-s', addonPath,
  ], {
    env: directEnvironment(environment, token),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new MitmdumpProcess(child);
}

/** 夹具进程不继承主机代理变量；urllib 回调还应显式使用 ProxyHandler({})。 */
function directEnvironment(environment: NodeJS.ProcessEnv, token: string): NodeJS.ProcessEnv {
  const result = { ...environment };
  for (const name of Object.keys(result)) {
    if (/^(http|https|all|no)_proxy$/i.test(name)) delete result[name];
  }
  return { ...result, no_proxy: 'localhost,127.0.0.1,::1', MITMPROXY_CONTROL_TOKEN: token };
}
