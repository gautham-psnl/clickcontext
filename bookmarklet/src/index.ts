import { startPicker } from './picker';
import { captureUiContext } from './capture';
import { sendCapture } from './send';
import { toast } from './toast';

startPicker(async (el) => {
  const ctx = captureUiContext(el);
  // Surface the capture in the page console so you can inspect it without the daemon.
  console.log('%c[UI Context] captured', 'color:#4f46e5;font-weight:bold', ctx);
  const ok = await sendCapture(ctx);
  toast(
    ok ? `Captured ✓ (${ctx.meta.layers.join(', ')}) — see console` : 'UI Context daemon not reachable — is it running?',
    ok ? 'ok' : 'err',
  );
});
