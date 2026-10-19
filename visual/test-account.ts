// 原生测试仅使用本轮显式分配的 staging 凭据，不包含共享默认账号或密码。
export function getVisualTestAccount(env: NodeJS.ProcessEnv = process.env) {
  if (!env.VISUAL_USERNAME || !env.VISUAL_PASSWORD) throw new Error('登录测试缺少 VISUAL_USERNAME / VISUAL_PASSWORD。');
  return { username: env.VISUAL_USERNAME, password: env.VISUAL_PASSWORD };
}
export function canTopUpVisualAccount(username: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.VISUAL_USERNAME && env.VISUAL_PASSWORD && username === env.VISUAL_USERNAME);
}
