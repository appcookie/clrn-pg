import { expect } from '@playwright/test';
import type { NativeDevice, NativeNode } from './native-device';
import { fullyInside, intersectBounds, nativeViewport } from './native-viewport';

export type LegalDocument = 'user-agreement' | 'user-privacy';
const openedDocuments = new WeakMap<NativeDevice, LegalDocument>();

/** iOS 以 html-render/WKWebView 呈现正文，Web 的两个 screen testID 不在原生树中。 */
export function visibleLegalDocumentText(nodes: NativeNode[], size: { width: number; height: number }): string {
  const screen = { x: 0, y: 0, ...size };
  const render = nodes.find(node => node.res === 'html-render' && node.visible !== false);
  const back = nodes.find(node => node.res === 'back-button' && node.visible !== false && node.enabled);
  if (!render || !back) return '';
  if (!fullyInside(render.bounds, nativeViewport(nodes, render, screen).viewport)
    || !fullyInside(back.bounds, nativeViewport(nodes, back, screen).viewport)) return '';
  const visibleNodes = new Set(nodes);
  const text = new Set<string>();
  function visit(node: NativeNode, viewport: typeof screen, insideWebView: boolean) {
    // WDA marks the tall HTML document aggregate as invisible even while its
    // paragraphs are individually visible. Traverse only these WebView Other
    // wrappers; visibility of WebViews and actual text leaves remains required.
    if (node.visible === false && !(insideWebView && node.clazz === 'XCUIElementTypeOther')) return;
    const webView = node.clazz === 'XCUIElementTypeWebView';
    const visible = webView ? intersectBounds(viewport, node.bounds) : viewport;
    if (visible.width <= 0 || visible.height <= 0) return;
    if (insideWebView && node.clazz === 'XCUIElementTypeStaticText' && visibleNodes.has(node)
      && fullyInside(node.bounds, visible) && node.text?.trim()) text.add(node.text.trim());
    for (const child of node.children) visit(child, visible, insideWebView || webView);
  }
  visit(render, render.bounds, false);
  return [...text].join('\n');
}

export async function waitForNativeLegalDocument(device: NativeDevice, document: LegalDocument) {
  // 协议入口的真实正文也使用“隐私政策”文案，不能凭共有 html-render 推断入口类型。
  if (openedDocuments.get(device) !== document) throw new Error(`尚未通过对应原生入口打开 ${document}`);
  await device.wait({ res: 'html-render' });
  await expect.poll(async () => {
    const text = visibleLegalDocumentText(await device.nodes(), device.screenSize);
    return text.length >= 100 && /GoPlay360|来玩|來玩/i.test(text) && /privacy|隐私|隱私/i.test(text);
  }, { timeout: 60_000, message: `${document} 必须显示原生WebView内可阅读的品牌和隐私正文及返回按钮` }).toBe(true);
}

export async function openNativeLegalDocument(device: NativeDevice, document: LegalDocument,
  click: (identifier: string) => Promise<void>) {
  openedDocuments.delete(device);
  await device.wait({ res: 'html-render' }, { state: 'gone' });
  await click(`${document}-button`);
  openedDocuments.set(device, document);
  await waitForNativeLegalDocument(device, document);
}
