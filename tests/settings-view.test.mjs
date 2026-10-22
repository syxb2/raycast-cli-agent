import { build } from "esbuild";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

// Render the actual Settings form with deferred catalogs and in-memory settings.
// No Raycast process, user settings or native CLI is used.
const hostPath = resolve("tests/fixtures/chat-view-host.mjs");
const modules = {
  "settings-test-state": `export const state = {
    models: [], listeners: new Set(), labelCalls: 0,
    environment: Promise.resolve(), providers: Object.fromEntries(
      ["codex", "pi", "claude"].map(p => [p, {
        enabled: true, cliPath: "", configDir: "", environmentVariables: "",
        defaultModel: p+":default", visibleModels: [], customModels: [],
        modelAliases: {}, preferredThinkingByModel: {}, toolAccess: "read-only",
        effort: "", thinkingLevel: "", webSearch: false
      }])
    )
  };`,
  "@raycast/api": `export { Action, ActionPanel, Icon, Keyboard, List, showToast, Toast } from ${JSON.stringify(hostPath)};
    export const Form = Object.assign("Form", Object.fromEntries(
      ["Description", "Dropdown", "TagPicker", "TextArea", "TextField", "Checkbox", "Separator"]
        .map(name => [name, Object.assign(function(){}, {Item: name+"Item"})])
    ));
    export const useNavigation = () => ({pop(){}});`,
  "../lib/backend/environment": `import {state} from "settings-test-state";
    export const expandPath = p => p;
    export const loadEnvironment = () => state.environment;`,
  "../lib/models": `import {state} from "settings-test-state";
    export const browserModels = p => state.models.filter(m => m.value.startsWith(p+":"));
    export const modelLabel = value => {state.labelCalls++; return value;};
    export const sameModel = (a,b) => a === b;
    export const subscribeCatalog = fn => {state.listeners.add(fn);return () => state.listeners.delete(fn);};`,
  "../lib/settings": `import {state} from "settings-test-state";
    export const CLAUDE_EFFORTS=[], CODEX_EFFORTS=[], PI_THINKING_LEVELS=[], TOOL_ACCESS_OPTIONS=[];
    export const defaultSettings = () => ({providers: state.providers});
    export const getSettings = () => ({general:{}, providers: state.providers});
    export const normalizeProviderModel = (p, value) => {
      if (!value.trim()) throw new Error("empty model");
      return value.includes(":") ? value : p+":"+value;
    };
    export const updateProviderSettings = (p, value) => Object.assign(state.providers[p], value);
    export const updateGeneralSettings = () => {};`,
  "../lib/modelCatalog": `export const refreshProviderCatalog = async () => ({models: []});`,
  "../lib/languages": `export const LANGUAGES = [];`,
  "./ModelBrowser": `export const ModelBrowser = "ModelBrowser";`,
};
const { outputFiles } = await build({
  stdin: {
    contents: `export { SettingsView } from "./src/components/SettingsView";
      export { createHost } from ${JSON.stringify(hostPath)};
      export { state } from "settings-test-state";`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  plugins: [
    {
      name: "settings-memory-host",
      setup(b) {
        b.onResolve({ filter: /.*/ }, ({ path }) => {
          if (path === hostPath) return { path };
          if (path === "react" || path === "react/jsx-runtime")
            return { path: hostPath };
          if (Object.hasOwn(modules, path))
            return { path, namespace: "memory" };
        });
        b.onLoad({ filter: /.*/, namespace: "memory" }, ({ path }) => ({
          contents: modules[path],
          loader: "js",
        }));
      },
    },
  ],
});
const require = createRequire(import.meta.url);
function setup(provider, selected) {
  const module = { exports: {} };
  new Function("module", "exports", "require", outputFiles[0].text)(
    module,
    module.exports,
    require,
  );
  const api = module.exports;
  api.state.providers[provider].visibleModels = selected;
  const root = api.createHost(api.SettingsView, {});
  const target = nodes(root.render()).find(
    (node) => node.props?.target?.props.provider === provider,
  ).props.target;
  const host = api.createHost(target.type, target.props);
  return { ...api, host };
}
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value?.props) return [];
  return [value, ...nodes(value.props.children), ...nodes(value.props.actions)];
}
function validate(tree) {
  const controls = nodes(tree).filter((node) =>
    ["visibleModels", "defaultModel"].includes(node.props.id),
  );
  assert.equal(controls.length, 2);
  for (const { props } of controls) {
    const values = nodes(props.children).map((item) => item.props.value);
    for (const selected of Array.isArray(props.value)
      ? props.value
      : [props.value])
      assert.ok(
        values.includes(selected),
        `${selected} is missing from ${props.id}`,
      );
  }
}

for (const [provider, model] of [
  ["pi", "pi:deepseek/deepseek-flash"],
  ["claude", "claude:opus"],
  ["codex", "codex:gpt-6.1-sol"],
]) {
  test(`${provider} settings preserve selected values through missing, loaded and invalidated catalogs`, async () => {
    const { state, host } = setup(provider, [model]);
    try {
      // Both controls must have valid items on their very first frame.
      validate(host.render());
      await Promise.resolve();
      state.models = [{ value: model, title: "Discovered model" }];
      state.listeners.forEach((fn) => fn());
      validate(host.render());
      state.models = [];
      state.listeners.forEach((fn) => fn());
      validate(host.render());
      host.frames.forEach(validate);
      assert.deepEqual(state.providers[provider].visibleModels, [model]);
    } finally {
      host.dispose();
    }
    assert.equal(state.listeners.size, 0);
  });
}

test("settings reload cached items after environment initialization without rediscovery", async () => {
  const { state, host } = setup("pi", ["pi:deepseek/deepseek-flash"]);
  let finish;
  state.environment = new Promise((resolve) => {
    finish = resolve;
  });
  try {
    host.render();
    state.models = [{ value: "pi:deepseek/deepseek-flash", title: "DeepSeek" }];
    finish();
    await Promise.resolve();
    const tree = host.render();
    validate(tree);
    const picker = nodes(tree).find(
      (node) => node.props.id === "visibleModels",
    );
    assert.equal(nodes(picker.props.children)[0].props.title, "DeepSeek");
  } finally {
    host.dispose();
  }
});

test("large settings catalogs reuse labels and do not re-resolve every item", () => {
  const { state, host } = setup("pi", ["pi:provider/m0"]);
  state.models = Array.from({ length: 400 }, (_, i) => ({
    value: `pi:provider/m${i}`,
    title: `Model ${i}`,
  }));
  try {
    validate(host.render());
    assert.equal(state.labelCalls, 0);
  } finally {
    host.dispose();
  }
});

test("legacy native-default selections are valid TagPicker items", () => {
  const { host } = setup("pi", ["pi:default"]);
  try {
    validate(host.render());
  } finally {
    host.dispose();
  }
});
