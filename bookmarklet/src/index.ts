import { startPicker } from './picker';
import { captureUiContext } from './capture';
import { sendCapture } from './send';
import { toast } from './toast';

startPicker(async (el) => {
  const ctx = captureUiContext(el);
  const ok = await sendCapture(ctx);
  toast(
    ok ? `Captured ✓ (${ctx.meta.layers.join(', ')})` : 'UI Context daemon not reachable — is it running?',
    ok ? 'ok' : 'err',
  );
});
