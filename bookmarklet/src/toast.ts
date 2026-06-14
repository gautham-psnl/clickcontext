export function toast(message: string, kind: 'ok' | 'err' = 'ok'): void {
  const el = document.createElement('div');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed', bottom: '16px', right: '16px', zIndex: '2147483647',
    padding: '10px 14px', borderRadius: '8px', font: '13px system-ui, sans-serif',
    color: '#fff', maxWidth: '320px',
    background: kind === 'ok' ? '#16a34a' : '#dc2626',
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}
