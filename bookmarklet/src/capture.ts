import type { UiContext, MissingLayer } from '@ui/shared';
import { captureDom } from './layers/dom';
import { captureAccessibility } from './layers/accessibility';
import { captureComponent } from './layers/component';
import { captureSource } from './layers/source';

export function captureUiContext(el: Element): UiContext {
  const dom = captureDom(el);
  const accessibility = captureAccessibility(el);
  const component = captureComponent(el);
  const source = captureSource(el);

  const layers = ['dom', 'accessibility'];
  const missing: MissingLayer[] = [];

  if (component.available) layers.push('component');
  else missing.push({ layer: 'component', reason: 'no React fiber on element' });

  if (source.available) layers.push('source');
  else missing.push({ layer: 'source', reason: source.reason ?? 'unavailable' });

  return {
    dom,
    accessibility,
    component,
    source,
    meta: { url: location.href, capturedAt: new Date().toISOString(), layers, missing },
  };
}
