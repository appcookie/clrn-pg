// 两阶段只消费准备 job 保存的同一份包，不重新解析可能变化的 Release。
import { join } from 'node:path';
import { artifactDirectory, readVerifiedBuild, simulatorPackageName, verifySimulatorPackage } from './release.mjs';

const information = readVerifiedBuild();
await verifySimulatorPackage(join(artifactDirectory, simulatorPackageName), information);
console.log(`本轮固定构建：${information.applicationCommit} / SHA-256 ${information.package.sha256}`);
