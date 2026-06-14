export interface PickerHandle {
  cancel(): void;
}

export function startPicker(onSelect: (el: Element) => void): PickerHandle {
  const box = document.createElement('div');
  Object.assign(box.style, {
    position: 'fixed', pointerEvents: 'none', zIndex: '2147483647',
    border: '2px solid #4f46e5', background: 'rgba(79,70,229,0.12)',
    borderRadius: '2px', transition: 'all 40ms ease', display: 'none', top: '0', left: '0',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(box);

  let current: Element | null = null;

  function move(e: MouseEvent): void {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box) return;
    current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, {
      display: 'block', left: `${r.left}px`, top: `${r.top}px`,
      width: `${r.width}px`, height: `${r.height}px`,
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
  }

  document.addEventListener('mousemove', move, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);

  return { cancel: cleanup };
}
