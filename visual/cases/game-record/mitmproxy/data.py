"""战绩视觉数据：固定日期、三种玩法、三种来源及正负零积分。"""

PLAYER = 'visual-record-player'
CLUB = 'visual-record-club'
HOUSE = 'visual-record-house'
PREFIX = 'visual-record-'
SPECS = [
    ('private', 'TexasHoldem:Classic', 'house', 'chip', 180, 10, 'Private Texas'),
    ('club', 'ZhaJinHua:Classic', 'club', 'coin', -90, 6, 'Club Cards'),
    ('hall', 'TexasHoldem:Classic', 'hall', 'coin', 0, 4, 'Hall Texas'),
    ('short', 'TexasHoldem:6Plus', 'house', 'chip', 1200, 8, 'Short Deck'),
    ('empty', 'TexasHoldem:Classic', 'house', 'chip', 0, 0, 'No Hands'),
    ('large', 'TexasHoldem:Classic', 'house', 'coin', -1234567.5, 12,
     'Long Room Name ABCDE'),
]


def records():
    return [{
        'play_session_id': PREFIX + key,
        'create_at': f'2026-01-0{2 if index < 3 else 1}T12:00:00Z',
        'modify_at': '2026-01-02T13:00:00Z', 'score': score, 'name': name,
        'all_round_count': count, 'game_profile': {'game_type': game, 'currency_name': currency},
        'building': {'room_id': PREFIX + key, 'room_name': name, **{
            'house': {'house_id': HOUSE},
            'club': {'club_id': CLUB, 'club_name': 'Visual Club'},
            'hall': {'hall_id': 'visual-record-hall'},
        }[building]},
    } for index, (key, game, building, currency, score, count, name) in enumerate(SPECS)]


def all_records():
    # 分页首屏使用二十条，避免短列表同时触发自动补页与滚动加载。
    base = records()
    extra = []
    for index in range(17):
        room_id = PREFIX + f'page-{index + 1:02}'
        name = f'Paged Texas {index + 1:02}'
        extra.append({**base[0], 'play_session_id': room_id, 'name': name,
                      'building': {**base[0]['building'], 'room_id': room_id, 'room_name': name}})
    return base[:-1] + extra + base[-1:]


def rooms():
    return {record['play_session_id']: {
        'room_id': record['play_session_id'], 'room_name': record['name'],
        'created_at': record['create_at'], 'creator_id': HOUSE,
        'building_id': CLUB if 'club_id' in record['building'] else HOUSE,
        'building_type': next(kind for kind in ('club', 'house', 'hall')
                              if f'{kind}_id' in record['building']),
        'game_type': 'zhajinhua' if record['game_profile']['game_type'].startswith('Zha') else 'texas_holdem',
        'room_status': 'closed', 'timer_status': 'time_out', 'booking_seconds': 3600,
        'remaining_seconds': 0, 'options': {
            'club_id': CLUB, 'club_name': 'Visual Club',
            'game_version': {'type': 'texas_holdem', 'variant': 'normal', 'buildNumber': 1,
                             'engineType': 'react_native'},
        },
        'game_config': {'currency': record['game_profile']['currency_name'],
                        'small_blind': 1, 'big_blind': 2, 'boot': 5, 'seat_quantity': 6,
                        'variation': 'six_plus_holdem' if record['play_session_id'].endswith('short')
                        else ('zhajinhua' if record['play_session_id'].endswith('club') else 'texas_holdem')},
    } for record in all_records()}


def settlements(user_id, room_id):
    record = next(record for record in all_records() if record['play_session_id'] == room_id)
    if not record['all_round_count']:
        return []
    return [{'user_id': player, 'settlement_amount': record['score'] * sign,
             'game_round_amount': record['all_round_count'], 'buy_in_amount': 1000}
            for player, sign in ((user_id, 1), (PLAYER, -1))]


def detail(user_id, session):
    record = next(record for record in all_records() if record['play_session_id'] == session)
    return {'all_round_id': [] if session.endswith('empty') else [session + '-round'],
            'game_profile': {'#settings': {'small_blind': 1, 'big_blind': 2, 'boot': 5}},
            'scoreboard': [{'player_id': player['user_id'], 'score': player['settlement_amount'],
                            'round_count': player['game_round_amount']}
                           for player in settlements(user_id, session)],
            'stake_tracker': [] if session.endswith('empty') else [
                {'at': record['create_at'], 'fund_in': 1000, 'fund_out': 0},
                {'at': '2026-01-02T13:00:00Z', 'fund_in': 0, 'fund_out': 820}]}


def round_data(user_id, session):
    zjh = session.endswith('club')
    return {'game_type': 'zhajinhua' if zjh else 'texas_holdem',
            'seats': {'1': user_id, '2': PLAYER},
            'all_seat_public': {'1': {'position': 'BTN', 'public_hole_card': 'as,ad,ah' if zjh else 'as,ad'},
                                '2': {'position': 'SB', 'public_hole_card': 'kh,ks,kd' if zjh else 'kh,ks'}},
            'user_secret': {'hole_card': 'as,ad,ah' if zjh else 'as,ad'},
            'actions': [
                {'name': 'ante' if zjh else 'small_blind', 'seat': '2', 'bet': 1, 'stack': 999},
                {'name': 'ante' if zjh else 'big_blind', 'seat': '1', 'bet': 2, 'stack': 998},
                {'name': 'call', 'seat': '2', 'street_bet': 20, 'stack': 980},
                *([{'name': 'pot_update', 'action_name': 'pot_update', 'pot_amount': 180}] if zjh else []),
                *([] if zjh else [
                    {'name': 'flop', 'community_card_1_to_3': 'ah,kd,7c'},
                    {'name': 'turn', 'community_card_4': '2s'},
                    {'name': 'river', 'community_card_5': 'qs', 'pots': [180]}]),
                {'name': 'showdown', 'seat': '1', 'hole_card': 'as,ad,ah' if zjh else 'as,ad',
                 'best_hand_cards': 'as,ad,ah', 'hand_strength': 'three_of_a_kind'},
                {'name': 'showdown', 'seat': '2', 'hole_card': 'kh,ks,kd' if zjh else 'kh,ks',
                 'best_hand_cards': 'kh,ks,kd', 'hand_strength': 'three_of_a_kind'},
                {'name': 'settlement' if zjh else 'award', 'seat': '1', 'net': 90, 'prize': 180},
                {'name': 'settlement' if zjh else 'award', 'seat': '2', 'net': -90, 'prize': 0}]}


def replay(user_id, index=1, session=PREFIX + 'private'):
    net = (180, -90, 0)[index - 1]
    zjh = session.endswith('club')
    players = [{'player_id': user_id, 'seat_number': 1, 'position': 'D', 'stack': 1000},
               {'player_id': PLAYER, 'seat_number': 2, 'position': 'SB', 'stack': 1000}]
    return {'game_id': f'{session}-game-{index}', 'game_number': index,
            'start_at': '2026-01-01T12:00:00Z', 'game_at': '2026-01-01T12:00:00Z',
            'actions': [
                {'action_name': 'begin_play', 'game': {'variation': 'zha_jin_hua' if zjh else 'texas_holdem'},
                 'table': {'players': players}},
                {'action_name': 'deal_hole_card', 'player_id': user_id, 'hole_card': ['as', 'ad']},
                {'action_name': 'call', 'player_id': PLAYER, 'amount': 20, 'stack': 980},
                {'action_name': 'pot_update' if zjh else 'pots_updated', 'pot_amount': 180, 'pots': [180]},
                *([{'action_name': 'start_round', 'round': 1}] if zjh else [
                    {'action_name': 'start_street', 'street': 'river', 'community_card': ['ah', 'kd', '7c', '2s', 'qs']}]),
                {'action_name': 'showdown', 'players': [
                    dict(players[0], hole_card=['as', 'ad', 'ah'] if zjh else ['as', 'ad'],
                         strength_cards=['as', 'ad', 'ah'], hand_strength='three_of_a_kind',
                         is_max_strength=True, is_winner=True),
                    dict(players[1], hole_card=['kh', 'ks', 'kd'] if zjh else ['kh', 'ks'],
                         strength_cards=['kh', 'ks', 'kd'], hand_strength='three_of_a_kind',
                         is_max_strength=False, is_winner=False)]},
                {'action_name': 'settlement', 'players': [
                    dict(players[0], net=net), dict(players[1], net=-net)]}]}
