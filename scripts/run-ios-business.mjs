import { executeIosGroups, assertGroupsPassed } from './ios-ci-groups.mjs';
import { nativeHooks, writeBusinessSummary } from './ios-ci-native.mjs';

const plan = JSON.parse(process.env.IOS_BUSINESS_PLAN);
const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => controller.abort());
}
const results = await executeIosGroups(plan.groups, nativeHooks(plan, process.env, controller.signal));
writeBusinessSummary(plan, results);
assertGroupsPassed(plan.groups, results);
