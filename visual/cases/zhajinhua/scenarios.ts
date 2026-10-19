import presentation from '../../fixtures/game-presentation.json' with { type: 'json' };
import type { SignedInPageDef } from '../../scenarioTypes';

export const PRE_GAME_STATES = [
  'waiting_table', 'menu', 'card_rank', 'theme', 'settings', 'buy_in', 'renew',
  'leaderboard', 'game_record', 'chat', 'buy_in_applications',
  'theme_four_color', 'theme_four_color_two', 'theme_realistic',
  'table_blue', 'table_purple', 'table_black', 'settings_enabled',
] as const;

export const GAME_STATES = [
  'blind_cards', 'seen_cards', 'quick_raise', 'accurate_raise', 'challenge_select',
  'opponent_turn', 'showdown', 'settlement',
] as const;

const common = {
  tabTestId: 'private-room-tab',
  visualReadySelector: '[data-testid="copy-house-number-button"]',
  fixedTexts: [
    { selector: '[data-testid="zhajinhua-room-id-text"]', text: presentation.roomNumber },
    { selector: '[data-testid="zhajinhua-text-room-name"]', text: 'TestRoom' },
    { selector: '[data-testid="player_nickname"]', text: 'TestPlayer' },
    { selector: '[data-testid="ping-screen-text"]', text: '0ms' },
    { selector: '[data-testid="renew-popup-remain-diamond"]', text: '60' },
    { selector: '[data-testid="public-leader-board-container"] > :last-child', text: '00000000-0000-0000-0000-000000000000' },
  ],
};

export const pages: SignedInPageDef[] = [
  { ...common, label: 'signed_in_zhajinhua_pre_game', snapshotStates: [...PRE_GAME_STATES] },
  { ...common, label: 'signed_in_zhajinhua_game', snapshotStates: [...GAME_STATES] },
];
