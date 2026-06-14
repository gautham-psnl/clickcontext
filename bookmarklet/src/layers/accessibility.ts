import { computeAccessibleName, computeAccessibleDescription } from 'dom-accessibility-api';
import type { AccessibilityLayer } from '@ui/shared';
import { implicitRole } from '../roles';

export function captureAccessibility(el: Element): AccessibilityLayer {
  return {
    role: el.getAttribute('role') || implicitRole(el),
    name: computeAccessibleName(el),
    description: computeAccessibleDescription(el),
    disabled: (el as HTMLElement).matches?.(':disabled') || el.getAttribute('aria-disabled') === 'true',
    ariaHidden: el.getAttribute('aria-hidden') === 'true',
  };
}
