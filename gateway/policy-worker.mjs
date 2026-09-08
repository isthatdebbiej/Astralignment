// Untrusted source executes inside QuickJS/WASM, never inside the host JS VM.
// No host functions, filesystem, network, timers, process or module loader are exposed.
import { parentPort } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';
const QuickJS = await getQuickJS();
parentPort.on('message', ({ id, source, input }) => {
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(8 * 1024 * 1024);
  runtime.setMaxStackSize(256 * 1024);
  const deadline = performance.now() + 80;
  runtime.setInterruptHandler(() => performance.now() > deadline);
  const context = runtime.newContext();
  try {
    const value = context.newString(JSON.stringify(input));
    context.setProp(context.global, '__inputJSON', value);
    value.dispose();
    const result = context.evalCode(`
      globalThis.Date = undefined;
      Math.random = () => { throw new Error('Use deterministic input state, not random'); };
      ${source}
      if (typeof coordinate !== 'function') throw new Error('Define function coordinate(input)');
      JSON.stringify(coordinate(JSON.parse(__inputJSON)));
    `, 'coordination.js');
    if (result.error) {
      const detail = context.dump(result.error);
      result.error.dispose();
      throw new Error(String(detail?.message || detail));
    }
    const json = context.getString(result.value);
    result.value.dispose();
    if (json.length > 16000) throw new Error('Controller output exceeds 16 KB');
    parentPort.postMessage({ id, output: JSON.parse(json) });
  } catch (error) {
    parentPort.postMessage({ id, error: String(error?.message || error).slice(0, 500) });
  } finally {
    context.dispose();
    runtime.dispose();
  }
});
parentPort.postMessage({ ready: true });
