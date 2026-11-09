import { spawn } from 'node:child_process';

function killGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

// npm, Playwright, Appium and proxies must all stop before the next group.
export function runCiCommand(command, args, env, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('执行已取消'));
    const child = spawn(command, args, { env, stdio: 'inherit', detached: true });
    let force;
    const abort = () => {
      killGroup(child, 'SIGTERM');
      force = setTimeout(() => killGroup(child, 'SIGKILL'), 10_000);
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', error => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(force);
      reject(error);
    });
    child.once('exit', (code, exitSignal) => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(force);
      killGroup(child, 'SIGKILL');
      if (code === 0 && !signal?.aborted) resolve();
      else reject(new Error(`${command} 退出：${exitSignal || code}`));
    });
  });
}
