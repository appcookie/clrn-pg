import { LEGACY_STATES, V2_STATES } from '../../visual/cases/game-record/scenarios';

// 原生与 Web 共用完整业务状态，顺序差异或漏执行直接失败。
export const recordStates = { legacy: LEGACY_STATES, v2: V2_STATES };
