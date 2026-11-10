import type { NativeNode } from './game-controls';

/** Preserve hidden renew markers from the original tree's children, without another query. */
export function renewalMarkerEvidence(nodes: NativeNode[]) {
  const seen = new Set<NativeNode>();
  const result: { marker: string; visible: boolean | undefined; bounds: NativeNode['bounds'] }[] = [];
  const visit = (node: NativeNode) => {
    if (seen.has(node)) return;
    seen.add(node);
    if (['renew-popup-close-button', 'renew-popup-confirm-button', 'renew-popup-slider'].includes(node.res || '')) {
      result.push({ marker: node.res!, visible: node.visible, bounds: node.bounds });
    }
    node.children?.forEach(visit);
  };
  nodes.forEach(visit);
  return result.slice(0, 16);
}
