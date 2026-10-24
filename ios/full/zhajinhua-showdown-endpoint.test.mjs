// 用真实皇冠遮挡AX的摊牌树验证双方完整手牌，禁止用一个隐藏标记冒充完成。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { requireZhajinhuaShowdownPlayers } from './zhajinhua-showdown-endpoint.ts';

const root = new URL('./fixtures/zhajinhua-showdown-endpoint/', import.meta.url);
const source = JSON.parse(readFileSync(new URL('provenance.json', root)));
const bytes = readFileSync(new URL('native-state.json', root));
assert.equal(createHash('sha256').update(bytes).digest('hex'), source.nativeStateSha256);
const original = JSON.parse(bytes), screen = { width: 1178, height: 2556 };
const verify = nodes => requireZhajinhuaShowdownPlayers(nodes, source.winner, source.loser, screen);
const wrappers = player => player.children.filter(n => n.children?.some(c => c.res === 'sprite-image-content'));

test('真实截图中双方三牌可见，皇冠使己方AX容器隐藏时验证完整玩家子树而不改属性', () => {
  const before = JSON.stringify(original);
  assert.equal(original[0].children.find(n => n.res === 'player_cards_container').visible, false);
  assert.equal(original[1].children.find(n => n.res === 'player_cards_container').visible, true);
  verify(original);
  assert.equal(JSON.stringify(original), before);
});

test('任一玩家、牌面或牌型缺失，未展开、越界或无真实皇冠图像时仍失败', () => {
  const changes = [
    n => n.pop(),
    n => { n[0].visible = false; },
    n => { n[1].res = 'zhajinhua-player-container-unrelated'; },
    n => n.push(structuredClone(n[0])),
    n => { n[0].children = n[0].children.filter(c => c.res !== 'player_cards_container'); },
    n => { n[1].children.splice(n[1].children.indexOf(wrappers(n[1])[2]), 1); },
    n => { wrappers(n[0])[2].children = []; },
    n => { wrappers(n[0])[2].bounds.x = -1; },
    n => { for (const c of wrappers(n[0])[2].children) c.bounds.x -= 40; },
    n => { n[0].children = n[0].children.filter(c => c.res !== '3 of Kind'); },
    n => { n[0].children = n[0].children.filter(c => c.res !== 'player_victory_container'); },
    n => { n[0].children[0].visible = false; },
    n => { n[0].children[0].children[0].visible = false; },
    n => { n[1].children.find(c => c.res === 'player_cards_container').visible = false; },
  ];
  for (const change of changes) {
    const nodes = structuredClone(original); change(nodes);
    assert.throws(() => verify(nodes));
  }
  assert.throws(() => requireZhajinhuaShowdownPlayers(original, source.winner, source.winner, screen), /不同玩家/);
});
