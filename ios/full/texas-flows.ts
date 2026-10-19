import { gamePreGame } from './game-pregame';
import { texasGameplay } from './texas-gameplay';
import { texasControlVariants } from './texas-control-variants';
import { texasTableVariants } from './texas-table-variants';
import { texasOptionalPreGame, texasRecordVariants } from './texas-record-variants';
import { texasPanels } from './texas-panels';
import { texasPanelVariants } from './texas-panel-variants';
import { texasHall, texasHallVariants } from './texas-hall';
import type { TexasContext } from './texas-support';

const flows: Record<string, (context: TexasContext) => Promise<void>> = {
  signed_in_texas_optional_pre_game: texasOptionalPreGame,
  signed_in_texas_controls: texasControlVariants,
  signed_in_texas_table_states: texasTableVariants,
  signed_in_texas_records_v2: texasRecordVariants,
  signed_in_texas_panels: texasPanels,
  signed_in_texas_panel_variants: texasPanelVariants,
  signed_in_texas_hall: texasHall,
  signed_in_texas_hall_variants: texasHallVariants,
};
export const texasScenarioLabels = ['signed_in_texas_pre_game', 'signed_in_texas_game', ...Object.keys(flows)];

/**
 * 显式分派全部 Web 德州场景；新增 Web 场景没有适配时必须失败。
 * @param label - 共用场景名。
 * @param context - 当前真实房间及原生操作上下文。
 * @param phase - 英文对局拆分后的执行部分。
 */
export async function runTexasScenario(label: string, context: TexasContext,
  phase: 'all' | 'table' | 'effects' = 'all'): Promise<void> {
  if (label === 'signed_in_texas_pre_game') {
    await gamePreGame(context.device, 'texas-holdem', context.capture);
  } else if (label === 'signed_in_texas_game') {
    await texasGameplay(context.device, context.proxy, context.room, context.self, context.capture,
      context.animationInfo, phase);
  } else {
    if (!flows[label]) throw new Error(`缺少 Android 德州场景实现：${label}`);
    await flows[label](context);
  }
}
