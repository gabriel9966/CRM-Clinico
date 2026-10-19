import { getQuickJS, type QuickJSHandle } from "quickjs-emscripten";

/** Guest code has its own JS heap. Only JSON crosses the host boundary. */
export async function executeIsolatedCode(
  code: string,
  globals: Record<string, unknown>,
  api: Record<string, (...args: never[]) => unknown>,
  log: (...args: unknown[]) => void,
  timeoutMs = 5000,
): Promise<unknown> {
  if (code.length > 64_000) throw new Error("Código excede 64.000 caracteres.");
  const engine = await getQuickJS();
  const runtime = engine.newRuntime();
  runtime.setMemoryLimit(16 * 1024 * 1024);
  runtime.setMaxStackSize(512 * 1024);
  const deadline = Date.now() + timeoutMs;
  runtime.setInterruptHandler(() => Date.now() >= deadline);
  const vm = runtime.newContext();
  const promises: ReturnType<typeof vm.newPromise>[] = [];
  let disposed = false;
  let calls = 0;
  const json = (value: unknown): QuickJSHandle => {
    const serialized = JSON.stringify(value ?? null);
    if (serialized.length > 512_000) throw new Error("Resultado excede o limite do bloco.");
    return vm.unwrapResult(vm.evalCode(`JSON.parse(${JSON.stringify(serialized)})`));
  };
  try {
    const crm = vm.newObject();
    for (const [name, fn] of Object.entries(api)) {
      const handle = vm.newFunction(name, (...args) => {
        if (++calls > 100 || Date.now() >= deadline) throw new Error("Limite de chamadas do bloco atingido.");
        const values = args.map((arg) => vm.dump(arg));
        const deferred = vm.newPromise();
        promises.push(deferred);
        Promise.resolve().then(() => {
          if (disposed || Date.now() >= deadline) throw new Error("Tempo do bloco esgotado.");
          return fn(...values as never[]);
        }).then((result) => {
          if (disposed) return;
          const value = json(result);
          deferred.resolve(value);
          value.dispose();
        }).catch((error) => {
          if (disposed) return;
          const value = vm.newError(error instanceof Error ? error.message : String(error));
          deferred.reject(value);
          value.dispose();
        });
        return deferred.handle;
      });
      vm.setProp(crm, name, handle);
      handle.dispose();
    }
    const logger = vm.newFunction("log", (...args) => { log(...args.map((arg) => vm.dump(arg))); });
    vm.setProp(crm, "log", logger);
    vm.setProp(vm.global, "crm", crm);
    crm.dispose();
    const consoleHandle = vm.newObject();
    vm.setProp(consoleHandle, "log", logger);
    vm.setProp(vm.global, "console", consoleHandle);
    logger.dispose();
    consoleHandle.dispose();
    for (const [name, value] of Object.entries(globals)) {
      const handle = json(value);
      vm.setProp(vm.global, name, handle);
      handle.dispose();
    }
    const result = vm.unwrapResult(vm.evalCode(`(async () => { ${code}\n })()`));
    try {
      while (Date.now() < deadline) {
        const jobs = runtime.executePendingJobs(100);
        if (jobs.error) { const error = vm.dump(jobs.error); jobs.error.dispose(); throw new Error(error?.message || "Falha ao executar o bloco."); }
        const state = vm.getPromiseState(result);
        if (state.type === "fulfilled") { try { return vm.dump(state.value); } finally { state.value.dispose(); } }
        if (state.type === "rejected") { try { const error = vm.dump(state.error); throw new Error(error?.message || String(error)); } finally { state.error.dispose(); } }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw new Error("Tempo de execução do bloco esgotado.");
    } finally { result.dispose(); }
  } finally {
    disposed = true;
    for (const promise of promises) promise.dispose();
    vm.dispose();
    runtime.dispose();
  }
}
