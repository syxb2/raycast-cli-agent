import { build } from "esbuild";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

// Exercise the real catalog and model selection code with only in-memory
// storage and deferred providers. No native CLI or user configuration is used.
const modules = {
  "catalog-test-state": `export const state = {
    files: new Map(), reads: 0, settingsReads: 0, calls: [], toasts: [],
    keys: {codex:"codex-key", pi:"pi-key", claude:"claude-key"},
    settings: { general: {defaultProvider:"codex"}, providers: Object.fromEntries(
      ["codex", "pi", "claude"].map(p => [p, {
        enabled:p!=="claude", defaultModel:p+":default", visibleModels:null,
        customModels:[], modelAliases:{}
      }])
    )},
    fetch: {}, host: undefined, environment: undefined,
  };`,
  "@raycast/api": `import {state} from "catalog-test-state";
    export const environment={supportPath:"/virtual"};
    export const Toast={Style:{Failure:"failure"}};
    export const showToast=async (toast)=>{state.toasts.push(toast);};`,
  "node:fs": `import {state} from "catalog-test-state";
    export const mkdirSync=()=>{};
    export const readFileSync=(path)=>{if(path.endsWith("/models.json")) state.reads++;
      if(!state.files.has(path)) throw new Error("missing file"); return state.files.get(path);};
    export const writeFileSync=(path,value)=>{state.files.set(path,value);};
    export const renameSync=(from,to)=>{if(state.storageFailure) throw new Error(state.storageFailure);
      state.files.set(to,state.files.get(from));state.files.delete(from);};`,
  "./settings": `import {state} from "catalog-test-state";
    export const getSettings=()=>{state.settingsReads++;return state.settings;};
    export const getProviderSettings=(p)=>state.settings.providers[p];
    export const updateProviderSettings=(p,value)=>Object.assign(state.settings.providers[p],value);`,
  "./backend/environment": `import {state} from "catalog-test-state";
    export const loadEnvironment=async()=>{if(state.environment) await state.environment; return {};};
    export const providerFingerprint=(p)=>state.keys[p];`,
  react: `import {state} from "catalog-test-state";
    export const useState=(initial)=>{const h=state.host,i=h.cursor++;
      if(!(i in h.slots)) h.slots[i]=typeof initial==="function"?initial():initial;
      return [h.slots[i],value=>{if(h.disposed) h.lateUpdates++;h.slots[i]=typeof value==="function"?value(h.slots[i]):value;h.dirty=true;}];};
    export const useRef=(value)=>useState(()=>({current:value}))[0];
    export const useCallback=(fn,deps)=>{const h=state.host,i=h.cursor++;const prev=h.slots[i];
      if(!prev || !deps.every((d,j)=>Object.is(d,prev.deps[j]))) h.slots[i]={fn,deps};return h.slots[i].fn;};
    export const useEffect=(fn,deps)=>{const h=state.host,i=h.cursor++;const prev=h.slots[i];
      if(prev && deps.every((d,j)=>Object.is(d,prev.deps[j]))) return;
      h.effects.push(()=>{prev?.cleanup?.();h.slots[i]={deps,cleanup:fn()};});};`,
};
for (const provider of ["codex", "pi", "claude"])
  modules[`./${provider}`] = `import {state} from "catalog-test-state";
    export const fetch${provider[0].toUpperCase() + provider.slice(1)}Models=()=>{
      state.calls.push("${provider}");return state.fetch.${provider}();};`;
const { outputFiles } = await build({
  stdin: {
    contents: `export * from "./src/lib/modelCatalog"; export * from "./src/lib/models";
      export {state} from "catalog-test-state";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "catalog-memory-host",
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) =>
          Object.hasOwn(modules, path)
            ? { path, namespace: "memory" }
            : undefined,
        );
        b.onLoad({ filter: /.*/, namespace: "memory" }, ({ path }) => ({
          contents: modules[path],
          loader: "js",
        }));
      },
    },
  ],
});
const require = createRequire(import.meta.url);
const row = (value, resolvedModel) => ({
  value,
  title: value,
  ...(resolvedModel ? { resolvedModel } : {}),
});
const tick = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function setup() {
  const module = { exports: {} };
  new Function("module", "exports", "require", outputFiles[0].text)(
    module,
    module.exports,
    require,
  );
  const api = module.exports;
  for (const provider of ["codex", "pi", "claude"])
    api.state.fetch[provider] = async () => [row(`${provider}:fresh`)];
  return api;
}
function seed(api, overrides = {}) {
  const catalog = {
    version: 4,
    fingerprint: "legacy-complete",
    fetchedAt: Date.now(),
    models: [row("codex:cached"), row("pi:cached")],
    errors: {},
    providerFingerprints: { ...api.state.keys },
    providerFetchedAt: { codex: Date.now(), pi: Date.now() },
    ...overrides,
  };
  api.saveCatalog(catalog);
  return catalog;
}
function hookHost(api) {
  const host = {
    cursor: 0,
    slots: [],
    effects: [],
    dirty: true,
    lateUpdates: 0,
    disposed: false,
    render() {
      api.state.host = host;
      do {
        host.dirty = false;
        host.cursor = 0;
        host.value = api.useModels();
        host.effects.splice(0).forEach((fn) => fn());
      } while (host.dirty);
      return host.value;
    },
    dispose() {
      host.slots.forEach((slot) => slot?.cleanup?.());
      host.disposed = true;
    },
  };
  host.render();
  return host;
}

test("forced refresh is not swallowed by a simultaneous fresh-cache read", async () => {
  const api = setup();
  seed(api);
  await Promise.all([api.refreshCatalog(), api.refreshCatalog(true)]);
  assert.deepEqual(api.state.calls.sort(), ["codex", "pi"]);
  assert.ok(api.loadCatalog().models.some((m) => m.value === "codex:fresh"));
});

test("full and provider refreshes share a pending discovery for the same runtime", async () => {
  const api = setup(),
    codex = deferred();
  api.state.fetch.codex = () => codex.promise;
  const full = api.refreshCatalog(true);
  await tick();
  const single = api.refreshProviderCatalog("codex");
  await tick();
  assert.equal(api.state.calls.filter((p) => p === "codex").length, 1);
  codex.resolve([row("codex:shared")]);
  await Promise.all([full, single]);
  assert.ok(api.loadCatalog().models.some((m) => m.value === "codex:shared"));
});

test("a slow full refresh cannot overwrite a newer completed provider refresh", async () => {
  const api = setup(),
    pi = deferred();
  let n = 0;
  api.state.fetch.pi = () => pi.promise;
  api.state.fetch.codex = async () => [
    row(++n === 1 ? "codex:old" : "codex:new"),
  ];
  const full = api.refreshCatalog(true);
  await tick();
  assert.ok(api.loadCatalog().models.some((m) => m.value === "codex:old"));
  await api.refreshProviderCatalog("codex");
  pi.resolve([row("pi:latest")]);
  await full;
  assert.deepEqual(
    api
      .loadCatalog()
      .models.map((m) => m.value)
      .sort(),
    ["codex:new", "pi:latest"],
  );
});

test("an obsolete runtime cannot overwrite the catalog after a newer discovery", async () => {
  const api = setup(),
    old = deferred();
  api.state.fetch.codex = () => old.promise;
  const first = api.refreshProviderCatalog("codex");
  await tick();
  api.state.keys.codex = "changed";
  api.state.fetch.codex = async () => [row("codex:new-runtime")];
  await api.refreshProviderCatalog("codex");
  const rejected = assert.rejects(first, /configuration changed/);
  old.resolve([row("codex:old-runtime")]);
  await rejected;
  assert.deepEqual(
    api.browserModels("codex").map((m) => m.value),
    ["codex:new-runtime"],
  );
});

test("another provider's configuration change does not discard a valid discovery", async () => {
  const api = setup(),
    codex = deferred();
  api.state.fetch.codex = () => codex.promise;
  const pending = api.refreshProviderCatalog("codex");
  await tick();
  api.state.keys.pi = "changed";
  codex.resolve([row("codex:valid")]);
  await pending;
  assert.equal(api.browserModels("codex")[0].value, "codex:valid");
});

test("provider refresh preserves unrelated errors and timestamps; automatic retry targets only the failed provider", async () => {
  const api = setup();
  const previous = seed(api, { errors: { pi: "auth unavailable" } });
  await api.refreshProviderCatalog("codex");
  assert.deepEqual(api.loadCatalog().errors, { pi: "auth unavailable" });
  assert.equal(
    api.loadCatalog().providerFetchedAt.pi,
    previous.providerFetchedAt.pi,
  );
  api.state.calls = [];
  await api.refreshCatalog();
  assert.deepEqual(api.state.calls, ["pi"]);
  assert.deepEqual(api.loadCatalog().errors, {});
});

test("temporary discovery failure preserves the complete catalog without extending its freshness", async () => {
  const api = setup();
  const previous = seed(api);
  api.state.fetch.codex = async () => {
    throw new Error("catalog timed out");
  };
  await assert.rejects(api.refreshProviderCatalog("codex"), /timed out/);
  const failed = api.loadCatalog();
  assert.ok(failed.models.some((m) => m.value === "codex:cached"));
  assert.equal(
    failed.providerFetchedAt.codex,
    previous.providerFetchedAt.codex,
  );
  assert.equal(failed.fingerprint, "");
  api.state.fetch.codex = async () => [row("codex:recovered")];
  api.state.calls = [];
  await api.refreshCatalog();
  assert.deepEqual(api.state.calls, ["codex"]);
});

test("changed runtimes invalidate discovered models and aliases but retain explicit custom IDs", async () => {
  const api = setup();
  seed(api, {
    models: [
      row("codex:default", "codex:old"),
      row("codex:old"),
      row("claude:old"),
    ],
  });
  api.state.settings.providers.codex.customModels = ["codex:manual"];
  api.state.settings.providers.claude.customModels = ["claude:manual"];
  api.state.keys.codex = "changed";
  api.state.keys.claude = "changed";
  assert.deepEqual(
    api.browserModels("codex").map((m) => m.value),
    ["codex:manual"],
  );
  assert.deepEqual(
    api.browserModels("claude").map((m) => m.value),
    ["claude:manual"],
  );
  assert.equal(api.resolvedModel("codex:default"), "codex:default");
  api.state.fetch.codex = async () => {
    throw new Error("offline");
  };
  await assert.rejects(api.refreshProviderCatalog("codex"), /offline/);
  assert.ok(!api.loadCatalog().models.some((m) => m.value === "codex:old"));
  assert.equal(api.loadCatalog().providerFetchedAt.codex, undefined);
});

test("automatic refresh preserves independent freshness after a provider-only refresh", async () => {
  const api = setup();
  seed(api, { providerFetchedAt: { codex: 1, pi: Date.now() } });
  await api.refreshProviderCatalog("codex");
  api.state.calls = [];
  await api.refreshCatalog();
  assert.deepEqual(api.state.calls, []);
});

test("legacy complete cache timestamps migrate without making an unrefreshed provider newer", async () => {
  const api = setup();
  const previous = seed(api, {
    providerFetchedAt: undefined,
    fetchedAt: Date.now() - 10000,
  });
  await api.refreshProviderCatalog("codex");
  assert.equal(api.loadCatalog().providerFetchedAt.pi, previous.fetchedAt);
  api.state.calls = [];
  await api.refreshCatalog();
  assert.deepEqual(api.state.calls, []);
});

test("model matching uses one catalog/settings read and preserves ordering, aliases and visibility", () => {
  const api = setup();
  seed(api, {
    models: [
      ...Array.from({ length: 100 }, (_, i) => row(`codex:m${i}`)),
      row("codex:alias", "codex:m90"),
    ],
  });
  const settings = api.state.settings.providers.codex;
  settings.visibleModels = [
    "codex:alias",
    ...Array.from({ length: 10 }, (_, i) => `codex:m${90 + i}`),
  ];
  settings.modelAliases = { "codex:m90": "Preferred" };
  api.state.reads = 0;
  api.state.settingsReads = 0;
  const models = api.availableModels();
  assert.equal(api.state.reads, 1);
  assert.equal(api.state.settingsReads, 1);
  assert.equal(models.length, 10);
  assert.equal(models[0].title, "codex: Preferred");
  assert.deepEqual(
    models.map((m) => m.value),
    Array.from({ length: 10 }, (_, i) => `codex:m${90 + i}`),
  );
});

test("open model hooks publish the fast provider before the slow provider finishes", async () => {
  const api = setup(),
    pi = deferred();
  api.state.fetch.pi = () => pi.promise;
  const host = hookHost(api);
  await tick();
  assert.equal(host.render().isRefreshing, true);
  assert.ok(host.value.models.some((m) => m.value === "codex:fresh"));
  pi.resolve([row("pi:fresh")]);
  await tick();
  assert.equal(host.render().isRefreshing, false);
  host.dispose();
});

test("unmounted model hooks ignore late discovery completions and notifications", async () => {
  const api = setup(),
    codex = deferred();
  api.state.fetch.codex = () => codex.promise;
  const host = hookHost(api);
  await tick();
  host.dispose();
  codex.resolve([row("codex:late")]);
  await tick();
  assert.equal(host.lateUpdates, 0);
  assert.deepEqual(api.state.toasts, []);
});

test("overlapping hook refreshes leave loading owned by the latest request", async () => {
  const api = setup(),
    old = deferred(),
    latest = deferred();
  api.state.settings.providers.pi.enabled = false;
  api.state.fetch.codex = () => old.promise;
  const host = hookHost(api);
  await tick();
  api.state.keys.codex = "new";
  api.state.fetch.codex = () => latest.promise;
  const next = host.value.refresh(true);
  await tick();
  old.resolve([row("codex:old")]);
  await tick();
  assert.equal(host.render().isRefreshing, true);
  assert.deepEqual(api.state.toasts, []);
  latest.resolve([row("codex:latest")]);
  await next;
  assert.equal(host.render().isRefreshing, false);
  host.dispose();
});

test("opening a provider browser reuses fresh models but explicit refresh reaches the CLI", async () => {
  const api = setup();
  seed(api);
  await api.refreshProviderCatalog("codex", false);
  assert.deepEqual(api.state.calls, []);
  await api.refreshProviderCatalog("codex");
  assert.deepEqual(api.state.calls, ["codex"]);
});

test("storage failures reject refresh even when a previous catalog has an identical error message", async () => {
  const api = setup();
  seed(api, { errors: { codex: "disk unavailable" } });
  api.state.settings.providers.pi.enabled = false;
  api.state.storageFailure = "disk unavailable";
  await assert.rejects(api.refreshCatalog(true), /disk unavailable/);
});

test("all-provider failures retain diagnostic errors even without a usable cache", async () => {
  const api = setup();
  api.state.fetch.codex = async () => {
    throw new Error("codex offline");
  };
  api.state.fetch.pi = async () => {
    throw new Error("pi offline");
  };
  await assert.rejects(
    api.refreshCatalog(),
    /codex: codex offline[\s\S]*pi: pi offline/,
  );
  assert.deepEqual(api.loadCatalog().errors, {
    codex: "codex offline",
    pi: "pi offline",
  });
});
