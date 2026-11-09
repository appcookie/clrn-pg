// Reuse the visible-tree traversal from 4a8ead5 without its gesture or retry changes.
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', processEntities: false });
const tabs = new Set(['message-tab', 'private-room-tab', 'hall-tab', 'club-tab', 'settings-tab']);
const blockers = new Set(['alert', 'alert-message-text', 'popup-content-container',
  'confirm-pop-up-image-background', 'staging-dialog', 'staging-dialog-wrapper', 'html-render',
  'country-code-list', 'base-create-room-screen', 'username-or-email-sign-in-button']);
const modalTypes = new Set(['XCUIElementTypeAlert', 'XCUIElementTypeSheet', 'XCUIElementTypeKeyboard']);

function visibleDescendants(container, ancestorsVisible = true) {
  return Object.values(container).flatMap(value => {
    if (Array.isArray(value)) return value.flatMap(item => visibleDescendants({ item }, ancestorsVisible));
    if (!value || typeof value !== 'object') return [];
    const visible = ancestorsVisible && value.visible !== 'false';
    const current = value.type && visible ? [value] : [];
    return [...current, ...visibleDescendants(value, visible)];
  });
}

function tabSummary(node) {
  const rect = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(node[key])]));
  return { identifier: node.name, selected: node.value === '1', enabled: node.enabled === 'true', rect };
}

async function observe(driver, identifier, phase, observations) {
  try {
    const requestedUtc = new Date().toISOString();
    const nodes = visibleDescendants(parser.parse(await driver.source()));
    observations.push({ identifier, phase, requestedUtc, completedUtc: new Date().toISOString(),
      tabs: nodes.filter(node => node.type === 'XCUIElementTypeButton' && tabs.has(node.name)).map(tabSummary),
      blockers: [...new Set(nodes.filter(node => blockers.has(node.name)).map(node => node.name))],
      modalTypes: [...new Set(nodes.filter(node => modalTypes.has(node.type)).map(node => node.type))],
    });
  } catch {
    // A missing diagnostic must never replace the gesture's result or original exception.
  }
}

export async function selectTabWithDiagnostics(driver, identifier, observations) {
  await observe(driver, identifier, 'before', observations);
  try {
    return await driver.selectTab(identifier);
  } catch (error) {
    await observe(driver, identifier, 'failed', observations);
    throw error;
  }
}
