import type { SignedInPageDef } from '../../scenarioTypes';

export const LIST_STATES = ['loading', 'empty', 'list', 'list_bottom', 'select_none',
  'select_win', 'select_loss', 'select_all', 'select_clear', 'select_cancel',
  'swipe_delete', 'delete_confirm', 'delete_cancel', 'delete_blocked'] as const;
export const DETAIL_STATES = ['private_overview', 'private_relationship', 'private_relationship_switch',
  'private_actions', 'private_settlement',
  'replay_list', 'club_overview', 'club_actions', 'club_settlement', 'hall_overview',
  'short_deck_overview', 'no_hands', 'replay_empty'] as const;
export const LEGACY_STATES = [...LIST_STATES, ...DETAIL_STATES, 'delete_success', 'delete_failure',
  'pagination_loading', 'pagination_end', 'reopen'] as const;
export const V2_STATES = [...LIST_STATES, ...DETAIL_STATES,
  'list_failure', 'retry_success', 'detail_failure'] as const;

export const pages: SignedInPageDef[] = [
  { label: 'signed_in_game_records_legacy', tabTestId: 'settings-tab',
    visualReadySelector: '[data-testid="game-record"]', snapshotStates: [...LEGACY_STATES] },
  { label: 'signed_in_game_records_v2', tabTestId: 'settings-tab',
    visualReadySelector: '[data-testid="game-record"]', snapshotStates: [...V2_STATES] },
];
