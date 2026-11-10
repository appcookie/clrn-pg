// A successful WebDriver command is not proof that a native tab changed.
import { setTimeout as delay } from 'node:timers/promises';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', processEntities: false });
const modalTypes = new Set(['XCUIElementTypeAlert', 'XCUIElementTypeSheet', 'XCUIElementTypeKeyboard']);
const modalNames = new Set(['alert', 'alert-message-text', 'popup-content-container',
  'confirm-pop-up-image-background', 'staging-dialog', 'staging-dialog-wrapper', 'html-render',
  'country-code-list', 'base-create-room-screen', 'username-or-email-sign-in-button']);

function visibleDescendants(container, ancestorsVisible = true) {
  return Object.values(container).flatMap(value => {
    if (Array.isArray(value)) return value.flatMap(item => visibleDescendants({ item }, ancestorsVisible));
    if (!value || typeof value !== 'object') return [];
    const visible = ancestorsVisible && value.visible !== 'false';
    const current = value.type && visible ? [value] : [];
    return [...current, ...visibleDescendants(value, visible)];
  });
}

function rectangle(node) {
  return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(node[key])]));
}

function validRectangle(rect) {
  return Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}

function inside(point, rect) {
  return point.x >= rect.x && point.y >= rect.y
    && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

function tabState(xml, identifier, pages) {
  const nodes = visibleDescendants(parser.parse(xml));
  const tabs = nodes.filter(node => node.type === 'XCUIElementTypeButton' && Object.hasOwn(pages, node.name));
  const selected = tabs.filter(node => node.value === '1');
  const targets = tabs.filter(node => node.name === identifier);
  const target = targets.length === 1 ? targets[0] : undefined;
  const rect = rectangle(target || {});
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  const application = nodes.find(node => node.type === 'XCUIElementTypeApplication');
  return {
    selected: selected.length === 1 ? selected[0].name : null,
    ready: Object.keys(pages).filter(tab => nodes.some(node => node.name === pages[tab] && validRectangle(rectangle(node)))),
    target: { ...rect, enabled: target?.enabled === 'true' },
    actionable: !!application && target?.enabled === 'true' && validRectangle(rect) && inside(point, rectangle(application)),
    blockers: nodes.filter(node => modalTypes.has(node.type) || modalNames.has(node.name)).map(node => node.name || node.type),
  };
}

function assertActionable(state, identifier) {
  if (state.blockers.length) throw new Error(`标签切换被遮挡：${identifier} (${state.blockers.join(', ')})`);
  if (!state.actionable) throw new Error(`标签不可点击或尺寸无效：${identifier}`);
}

function pageReady(state, identifier) {
  return state.selected === identifier && state.ready.includes(identifier);
}

async function stableTab(read, identifier, { timeout, interval }) {
  let previous = await read();
  const deadline = Date.now() + timeout;
  do {
    assertActionable(previous, identifier);
    await delay(interval);
    const current = await read();
    assertActionable(current, identifier);
    if (pageReady(current, current.selected) && previous.selected === current.selected
      && JSON.stringify(previous.target) === JSON.stringify(current.target)) return current;
    previous = current;
  } while (Date.now() < deadline);
  throw new Error(`标签布局或原页面未就绪：${identifier}`);
}

async function waitForTab(read, identifier, origin, { timeout, interval }, mayRetry) {
  const deadline = Date.now() + timeout;
  const retryAt = Date.now() + Math.min(5000, timeout);
  let state;
  do {
    state = await read();
    if (state.blockers.length) assertActionable(state, identifier);
    if (pageReady(state, identifier)) return state;
    if (state.selected && state.selected !== origin && state.selected !== identifier) {
      throw new Error(`标签切换进入意外页面：${state.selected}`);
    }
    if (mayRetry && Date.now() >= retryAt && pageReady(state, origin)) return state;
    await delay(interval);
  } while (Date.now() < deadline);
  return state;
}

async function switchTab(driver, identifier, read, emit, options) {
  let origin;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const before = await stableTab(read, identifier, options);
    emit('before', attempt);
    if (pageReady(before, identifier)) return;
    if (attempt === 2 && before.selected !== origin) throw new Error(`标签重试前原页面已改变：${identifier}`);
    origin = before.selected;
    const { x, y, width, height } = before.target;
    await driver.request('POST', driver.path('/execute/sync'), {
      script: 'mobile: tap', args: [{ x: x + width / 2, y: y + height / 2 }],
    });
    const after = await waitForTab(read, identifier, origin, options, attempt === 1);
    emit('after', attempt);
    if (pageReady(after, identifier)) return;
    assertActionable(after, identifier);
    if (attempt === 2 || !pageReady(after, origin)) throw new Error(`标签切换未生效：${identifier}`);
    // Retry only the reversible tab tap, after proving we are still on the original unobstructed page.
    emit('retry', attempt);
  }
}

export async function selectTab(driver, identifier, { pages, timeout = 30_000, interval = 200, onObservation = () => {} }) {
  if (!Object.hasOwn(pages, identifier)) throw new Error(`缺少标签就绪标识：${identifier}`);
  let lastState;
  const read = async () => { lastState = tabState(await driver.source(), identifier, pages); return lastState; };
  const emit = (phase, attempt, error) => {
    const event = { identifier, phase, attempt, ...lastState, error };
    console.info(`IOS tab > ${JSON.stringify(event)}`);
    onObservation(event);
  };
  try {
    await switchTab(driver, identifier, read, emit, { timeout, interval });
    emit('complete');
  } catch (error) {
    emit('failed', undefined, error.message);
    throw error;
  }
}
