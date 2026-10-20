import assert from 'node:assert/strict';
import test from 'node:test';
import { openNativeLegalDocument, visibleLegalDocumentText, waitForNativeLegalDocument } from './legal-document.ts';
import { revealScenarioReady } from './navigation.ts';

const size = { width: 1178, height: 2556 };
const body = '下載來玩APP，即表示您已閱讀並理解本隱私政策的全文，且您同意本隱私政策的所有條款。'
  + '我們尊重您的隱私。本政策旨在告知您關於收集、使用和披露您通過網站或者APP提交的個人信息和匿名信息的政策和行為規範。'
  + '如果您不同意隱私政策的所有內容，請您停止APP的瀏覽及使用。';
function tree() {
  const make = (res, clazz, bounds, children = []) => ({ res, clazz, bounds, children, visible: true, enabled: true });
  const text = make('public-document-body', 'XCUIElementTypeStaticText', { x: 47, y: 519, width: 1051, height: 204 });
  text.text = body;
  const web = make(undefined, 'XCUIElementTypeWebView', { x: 0, y: 375, width: 1178, height: 2181 }, [text]);
  const render = make('html-render', 'XCUIElementTypeOther', { ...web.bounds }, [web]);
  const back = make('back-button', 'XCUIElementTypeOther', { x: 0, y: 270, width: 159, height: 42 });
  const root = make('app', 'XCUIElementTypeApplication', { x: 0, y: 0, ...size }, [back, render]);
  return { root, back, render, web, text, nodes: [root, back, render, web, text] };
}

test('真实繁体几何的html-render/WKWebView正文可读，无需Web专用screen标识或滚动整页', () => {
  const evidence = tree();
  assert.equal(visibleLegalDocumentText(evidence.nodes, size), body);
  assert.ok(!evidence.nodes.some(node => /user-(agreement|privacy)-screen/.test(node.res || '')));
});

test('真实WKWebView的超长不可访问文档聚合层，不遮蔽实际可见的完整正文叶子', () => {
  for (const height of [15915, 8679]) {
    const evidence = tree();
    const aggregate = { res: '隱私政策', clazz: 'XCUIElementTypeOther', visible: false, enabled: true,
      bounds: { x: 0, y: 375, width: 1178, height }, children: [evidence.text] };
    evidence.web.children = [aggregate];
    assert.ok(!evidence.nodes.includes(aggregate));
    assert.equal(visibleLegalDocumentText(evidence.nodes, size), body);
    evidence.text.visible = false;
    assert.equal(visibleLegalDocumentText(evidence.nodes, size), '');
  }
});

test('WebView子树中不在可见flat列表的叶子，不能借同文字副本冒充真实可读正文', () => {
  const evidence = tree();
  const copy = structuredClone(evidence.text);
  const nodes = evidence.nodes.filter(node => node !== evidence.text);
  nodes.push(copy);
  assert.equal(visibleLegalDocumentText(nodes, size), '');
  evidence.web.visible = false;
  assert.equal(visibleLegalDocumentText(evidence.nodes, size), '');
});

test('空文档、隐藏或屏外正文、同屏其他子树文案及不可用返回按钮不能冒充已加载文档', () => {
  for (const mutate of [
    item => { item.web.children = []; },
    item => { item.web.visible = false; },
    item => { item.render.visible = false; },
    item => { item.text.bounds.y = 2600; },
    item => { item.web.bounds.height = 100; },
    item => { item.web.children = []; item.root.children.push(item.text); },
    item => { item.back.enabled = false; },
  ]) {
    const evidence = tree();
    mutate(evidence);
    assert.equal(visibleLegalDocumentText(evidence.nodes, size), '');
  }
});

test('协议与隐私分别通过指定真实入口打开，已有同类WebView不能串用为另一文档', async () => {
  const evidence = tree();
  const events = [];
  let opened = false;
  const device = {
    screenSize: size,
    nodes: async () => opened ? evidence.nodes : [],
    wait: async (selector, options) => {
      assert.equal(selector.res, 'html-render');
      events.push(options?.state || 'visible');
      assert.equal(opened, options?.state !== 'gone');
    },
  };
  await assert.rejects(waitForNativeLegalDocument(device, 'user-agreement'), /对应原生入口/);
  for (const document of ['user-agreement', 'user-privacy']) {
    opened = false;
    await openNativeLegalDocument(device, document, async entry => {
      events.push(entry);
      assert.equal(entry, `${document}-button`);
      opened = true;
    });
    await revealScenarioReady(device, { visualReadySelector: `[data-testid="${document}-screen"]` });
    const other = document === 'user-agreement' ? 'user-privacy' : 'user-agreement';
    await assert.rejects(waitForNativeLegalDocument(device, other), /对应原生入口/);
  }
  assert.deepEqual(events, ['gone', 'user-agreement-button', 'visible', 'visible',
    'gone', 'user-privacy-button', 'visible', 'visible']);
});
