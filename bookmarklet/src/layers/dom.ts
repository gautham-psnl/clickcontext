import type { DomLayer } from '@ui/shared';
import { cssPathTo } from '../dom-path';

const MAX_HTML = 4000;
const STYLE_KEYS = [
  'display', 'opacity', 'pointerEvents', 'visibility', 'position',
  'color', 'backgroundColor', 'cursor',
] as const;

export function captureDom(el: Element): DomLayer {
  const cs = getComputedStyle(el as HTMLElement);
  const styles: Record<string, string> = {};
  for (const k of STYLE_KEYS) styles[k] = (cs as unknown as Record<string, string>)[k] ?? '';

  const attributes: Record<string, string> = {};
  for (const a of Array.from(el.attributes)) attributes[a.name] = a.value;

  const r = el.getBoundingClientRect();
  const outer = el.outerHTML;
  const html = outer.length > MAX_HTML ? `${outer.slice(0, MAX_HTML)}…` : outer;

  return {
    html,
    tag: el.tagName,
    attributes,
    domPath: cssPathTo(el),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    styles,
  };
}
