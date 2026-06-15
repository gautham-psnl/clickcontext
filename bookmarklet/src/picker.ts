export interface PickerHandle {
  cancel(): void;
}

/** Read the nearest component name for the hovered element: build-attr first, then fiber. */
function hoverLabel(el: Element): string {
  // Build-attr: data-clickcontext-source or data-locatorjs carries "/path:line:col"
  const found = el.closest('[data-clickcontext-source],[data-locatorjs]');
  if (found) {
    const raw = found.getAttribute('data-clickcontext-source') ?? found.getAttribute('data-locatorjs') ?? '';
    // Strip to just the filename (no dir, no :line:col) for a compact label.
    const lastColon = raw.lastIndexOf(':');
    const prevColon = lastColon > 0 ? raw.lastIndexOf(':', lastColon - 1) : -1;
    const filePart = prevColon > 0 ? raw.slice(0, prevColon) : raw;
    const fileName = filePart.split('/').pop() ?? filePart;
    const line = prevColon > 0 ? raw.slice(prevColon + 1, lastColon) : '';
    return line ? `${fileName}:${line}` : fileName;
  }

  // Fiber fallback: read component displayName/name from __reactFiber.
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (fiberKey) {
    let fiber = (el as unknown as Record<string, { type?: unknown; return?: unknown } | null>)[fiberKey];
    while (fiber) {
      const t = fiber.type;
      if (t && typeof t !== 'string') {
        const f = t as { displayName?: string; name?: string };
        const name = f.displayName ?? f.name;
        if (name && name.length > 0 && /^[A-Z]/.test(name)) return name;
      }
      fiber = fiber.return as typeof fiber;
    }
  }

  return el.tagName.toLowerCase();
}

export function startPicker(onSelect: (el: Element) => void): PickerHandle {
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    border: '2px solid #4f46e5', background: 'rgba(79,70,229,0.10)',
    borderRadius: '2px', transition: 'all 40ms ease', display: 'none', top: '0', left: '0',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(box);

  const chip = document.createElement('div');
  Object.assign(chip.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    background: '#4f46e5', color: '#fff', fontSize: '11px', fontFamily: 'monospace',
    fontWeight: '600', lineHeight: '1', padding: '3px 7px', borderRadius: '4px',
    whiteSpace: 'nowrap', display: 'none', maxWidth: '320px', overflow: 'hidden',
    textOverflow: 'ellipsis', boxShadow: '0 2px 8px rgba(0,0,0,.25)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(chip);

  let current: Element | null = null;

  function move(e: MouseEvent): void {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box || el === chip) return;
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block', left: `${r.left}px`, top: `${r.top}px`,
      width: `${r.width}px`, height: `${r.height}px`,
    } as Partial<CSSStyleDeclaration>);

    // Position chip above the element (or below if near the top of viewport).
    chip.textContent = hoverLabel(el);
    chip.style.display = 'block';
    const chipTop = r.top > 28 ? r.top - 22 : r.bottom + 4;
    Object.assign(chip.style, {
      left: `${Math.min(r.left, window.innerWidth - 330)}px`,
      top: `${chipTop}px`,
    } as Partial<CSSStyleDeclaration>);
  }

  function click(e: MouseEvent): void {
    e.preventDefault();
    e.stopPropagation();
    const el = current ?? document.elementFromPoint(e.clientX, e.clientY);
    cleanup();
    if (el) onSelect(el);
  }

  function key(e: KeyboardEvent): void {
    if (e.key === 'Escape') cleanup();
  }

  function cleanup(): void {
    document.removeEventListener('mousemove', move, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    box.remove();
    chip.remove();
  }

  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);

  return { cancel: cleanup };
}
