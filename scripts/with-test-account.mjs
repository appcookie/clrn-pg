/**
 * 为本机的一轮测试分配独立 staging 账号，并在测试结束后释放占用锁。
 *
 * @remarks
 * 例如：node scripts/with-test-account.mjs -- npm run test:functional:existing。
 * 脚本负责分配账号、准备金币和启动命令，实际测试仍由 npm/pnpm 等命令执行。
 * 本机不同 worktree 共用账号池；其他机器或手工登录不会被本机锁识别。
 *
 * @packageDocumentation
 */
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciAccounts } from './ci-accounts.mjs';
import { prepareTestAccountCoins, readTestingApiToken } from './prepare-test-account.mjs';
import { prepareTestAccountRooms } from './prepare-test-account-rooms.mjs';

// node 和脚本路径占据前两个参数；可选的 -- 用于分隔脚本和测试命令。
const args = process.argv.slice(2);
if (args[0] === '--') args.shift();
if (!args.length) {
  console.error('用法：node scripts/with-test-account.mjs -- <测试命令及参数>');
  process.exit(1);
}

/**
 * 读取账号池、独占空闲账号，并在用户当前目录执行测试命令。
 *
 * @remarks
 * 启动脚本所在 worktree 决定共享账号池的位置，调用者当前目录决定测试在哪里运行。
 * 占用账号时创建锁目录：创建成功即取得账号，目录已存在则尝试下一个账号。
 * 即使多个任务同时启动，原子 mkdir 也只允许一个任务取得同一账号。
 * 正常完成、测试失败或命令无法启动时，finally 都会释放锁。
 * SIGKILL 无法被捕获，因此强制杀死进程后可能需要人工清理残留锁。
 *
 * @returns 测试命令结束且锁已释放时完成，退出码通过 process.exitCode 传给调用者。
 */
async function run() {
  // 1. 使用 Git 的共同元数据目录，使不同 worktree 协调同一批账号。
  const repository = dirname(dirname(fileURLToPath(import.meta.url)));
  const common = execFileSync('git', [
    '-C', repository, 'rev-parse', '--path-format=absolute', '--git-common-dir',
  ], { encoding: 'utf8' }).trim();
  const poolFile = process.env.CLRN_TEST_ACCOUNT_POOL
    || join(common, 'clrn-ios-test-accounts', 'accounts.json');
  // 2. 凭据只从本机文件读取，不打印密码，也不将凭据写入测试报告。
  let accounts;
  try {
    accounts = JSON.parse(await readFile(poolFile, 'utf8')).accounts;
  } catch {
    throw new Error('测试账号池不可读取，请先准备本机 staging 测试账号');
  }
  if (!Array.isArray(accounts) || !accounts.length
    || accounts.some(account => typeof account.username !== 'string' || !account.username
      || typeof account.password !== 'string' || !account.password
      // H5 密码框最多接收 20 个字符；更长的密码虽然可走 API 登录，界面会截断。
      || account.password.length > 20 || /[\r\n\0]/.test(account.password)
      || typeof account.userId !== 'string' || !account.userId)
    || new Set(accounts.map(account => account.username.toLowerCase())).size !== accounts.length) {
    throw new Error('测试账号池为空、配置不完整、密码不兼容 H5 或包含重复用户名');
  }

  // 自定义账号池也使用旁边的 locks；共享账号时必须指定相同的账号池文件。
  if (accounts.some(account => (ciAccounts.includes(account.username.toLowerCase()) || /^clrnci(?:261009\d{2}|261015\d{3}|ios\d{3})$/i.test(account.username)))) {
    throw new Error('本机账号池禁止使用 CLRN 的 CI 专用账号，避免绕过 GitHub 账号锁');
  }
  const locks = join(dirname(poolFile), 'locks');
  await mkdir(locks, { recursive: true, mode: 0o700 });
  for (const account of accounts) {
    if (!/^[a-zA-Z0-9.]{6,30}$/.test(account.username)) {
      throw new Error('测试账号池包含非法用户名');
    }
  }

  // 3. 不能先判断目录不存在再创建，否则两个进程会同时选中同一个账号。
  let selected;
  let lock;
  for (const account of accounts) {
    const candidate = join(locks, account.username.toLowerCase());
    try {
      await mkdir(candidate, { mode: 0o700 });
      selected = account;
      lock = candidate;
      break;
    } catch (error) {
      // EEXIST 表示此账号正在被占用；权限或磁盘错误则应立即报错。
      if (error.code !== 'EEXIST') throw new Error('测试账号占用锁创建失败', { cause: error });
    }
  }
  if (!selected) {
    throw new Error('测试账号全部被占用；若上轮进程被强制终止，请确认它已结束后清理账号池 locks 中对应的目录');
  }

  try {
    // owner.json 只记录进程号和工作目录，方便排查残留锁，不保存密码。
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, cwd: process.cwd() }), { mode: 0o600 });
    const session = await prepareTestAccountCoins(selected, await readTestingApiToken());
    await prepareTestAccountRooms(session);
    console.error('已核对本轮账号金币余额为 10000');
    // 4. 三种测试都通过环境变量读取账号；只修改子进程的配置。
    const env = {
      ...process.env,
      E2E_TEST_USERNAME: selected.username, E2E_TEST_PASSWORD: selected.password,
      E2E_CREATION_USERNAME: selected.username, E2E_CREATION_PASSWORD: selected.password,
      VISUAL_USERNAME: selected.username, VISUAL_PASSWORD: selected.password,
    };
    // 显式创建账号状态会覆盖用户名；使用池账号时走真实登录流程。
    delete env.E2E_CREATION_STORAGE_STATE_FILE;
    console.error(`本轮使用独立 staging 测试账号：${selected.username}`);
    // 5. 直接执行参数而非拼接 shell 字符串，保留参数边界和调用者的工作目录。
    const grouped = process.platform !== 'win32';
    const child = spawn(args[0], args.slice(1), { env, stdio: 'inherit', detached: grouped });
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    const handlers = signals.map(signal => {
      /** 将退出信号转发给测试命令及其后代进程，避免任务结束后仍使用账号。 */
      const handler = () => {
        try {
          // npm/pnpm 会再启动测试进程，转发到进程组，避免退出后仍继续使用账号。
          if (grouped && child.pid) process.kill(-child.pid, signal);
          else child.kill(signal);
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      };
      process.on(signal, handler);
      return handler;
    });
    try {
      // 使用测试命令的退出码，让调用者和 CI 能识别真正的测试失败。
      process.exitCode = await new Promise((resolve, reject) => {
        child.once('error', () => reject(new Error('测试命令启动失败')));
        child.once('exit', (code, signal) => resolve(code ?? (signal === 'SIGINT' ? 130 : 143)));
      });
    } finally {
      signals.forEach((signal, index) => process.removeListener(signal, handlers[index]));
    }
  } finally {
    // 6. 只有我们取得的锁会被删除，不会清理其他任务的占用记录。
    await rm(lock, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
