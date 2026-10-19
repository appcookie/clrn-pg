/**
 * Playwright 请求错误的 Call log 包含 Authorization；报告仅保留首行失败原因。
 * @param error - 需要转换为安全诊断摘要的请求异常。
 */
export function requestErrorSummary(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0];
}
