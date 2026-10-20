import presentation from '../../fixtures/game-presentation.json' with { type: 'json' };
import type { SignedInPageDef } from '../../scenarioTypes';

/** 同一次真实建房进入牌桌后，依次采集所有无需开局的稳定界面。 */
export const PRE_GAME_STATES = [
  'waiting_table',
  'menu',
  'card_rank',
  'theme',
  'settings',
  'buy_in',
  'renew',
  'leaderboard',
  'game_record',
  'chat',
  'buy_in_applications',
] as const;

export const OPTIONAL_PRE_GAME_STATES = [
  'waiting_table',
  'raise_blinds',
] as const;

export const GAME_STATES = [
  'preflop', 'flop', 'turn', 'river', 'raise', 'accurate_raise',
  'opponent_turn', 'all_in', 'showdown', 'settlement',
  'own_profile', 'player_profile', 'player_statistics_1000', 'statistics_help', 'report', 'block',
] as const;

export const PANEL_STATES = [
  'theme_four_color', 'theme_four_color_two', 'theme_realistic',
  'table_blue', 'table_purple', 'table_black', 'settings_enabled', 'voice',
  'leaderboard_players', 'record_settlement', 'record_actions',
  'chat_phrases', 'chat_history', 'chat_actions', 'chat_report', 'chat_block_confirm',
  'buy_in_review', 'hand_end', 'remaining_cards', 'show_cards', 'quit_confirm',
] as const;

export const HALL_STATES = ['hall_table', 'hall_menu', 'auto_rebuy', 'pair_play_report',
  'personal_leaderboard', 'prediction', 'prediction_result', 'level_up'] as const;

export const RECORD_STATES = ['empty', 'actions', 'settlement'] as const;

export const CONTROL_STATES = [
  'check', 'all_in_only', 'all_in_call', 'shortcut_blinds', 'shortcut_disabled',
  'auto_buttons', 'auto_fold_selected', 'auto_call_selected', 'auto_check_selected',
  'raise_maximum', 'raise_dragging', 'accurate_raise_value', 'accurate_raise_minimum_error',
] as const;
export const TABLE_STATES = ['observer', 'full_table', 'full_table_multiple_pots', 'reserved_seat', 'player_disconnected', 'guest_menu'] as const;
export const PANEL_VARIANT_STATES = [
  'applications_pending', 'applications_resolved', 'applications_more',
  'chat_audio_history', 'chat_barrage_off', 'alert_retry', 'alert_insufficient_balance', 'alert_authentication_failed',
] as const;
export const HALL_VARIANT_STATES = [
  'auto_rebuy_enabled', 'pair_play_selected', 'prediction_bet', 'prediction_loss', 'prediction_diamond',
  'delay_cooldown', 'delay_cooldown_alert',
] as const;

const common: Omit<SignedInPageDef, 'label' | 'snapshotStates'> = {
  tabTestId: 'private-room-tab',
  visualReadySelector: '[data-testid="copy-house-number-button"]',
  fixedTexts: [
    { selector: '[data-testid="texas-holdem-room-id-text"]', text: presentation.roomNumber },
    { selector: '[data-testid="texas-holdem-room-name-text"]', text: 'TestRoom' },
    { selector: '[data-testid^="public-leader-board-item-nickname-"]', text: 'TestPlayer' },
    { selector: '[data-testid="public-leader-board-container"] > :last-child', text: '00000000-0000-0000-0000-000000000000' },
    { selector: '[data-testid="personal-leader-board-record-container"] + :last-child', text: '00000000-0000-0000-0000-000000000000' },
    { selector: '[data-testid="texas-holdem-nickname-text"]', text: 'TestPlayer' },
    // 固定文案用于稳定截图，不代表 mitmproxy 的真实延迟。
    { selector: '[data-testid="ping-screen-text"]', text: '0ms' },
    { selector: '[data-testid="renew-popup-remain-diamond"]', text: '60' },
  ],
};

export const pages: SignedInPageDef[] = [
  { ...common, label: 'signed_in_texas_pre_game', snapshotStates: [...PRE_GAME_STATES] },
  { ...common, label: 'signed_in_texas_optional_pre_game', snapshotStates: [...OPTIONAL_PRE_GAME_STATES] },
  { ...common, label: 'signed_in_texas_game', snapshotStates: [...GAME_STATES],
    fixedTexts: [...(common.fixedTexts || []), { selector: '[data-testid="player-profile-id"]', text: 'ID: 00000000' }] },
  { ...common, label: 'signed_in_texas_panels', snapshotStates: [...PANEL_STATES] },
  { ...common, label: 'signed_in_texas_hall', snapshotStates: [...HALL_STATES] },
  { ...common, label: 'signed_in_texas_records_v2', snapshotStates: [...RECORD_STATES] },
  { ...common, label: 'signed_in_texas_controls', snapshotStates: [...CONTROL_STATES] },
  { ...common, label: 'signed_in_texas_table_states', snapshotStates: [...TABLE_STATES] },
  { ...common, label: 'signed_in_texas_panel_variants', snapshotStates: [...PANEL_VARIANT_STATES] },
  { ...common, label: 'signed_in_texas_hall_variants', snapshotStates: [...HALL_VARIANT_STATES] },
];
