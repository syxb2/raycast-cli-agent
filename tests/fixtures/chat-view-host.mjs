// A small hook host for exercising ChatView's asynchronous native callbacks.
// No Raycast process, model CLI, user settings or chat files are touched.
let active;
export function useState(initial) {
  const host = active;
  const index = host.cursor++;
  if (!(index in host.slots))
    host.slots[index] = typeof initial === "function" ? initial() : initial;
  return [
    host.slots[index],
    (value) => {
      host.slots[index] =
        typeof value === "function" ? value(host.slots[index]) : value;
      host.dirty = true;
    },
  ];
}
export function useRef(current) {
  return useState(() => ({ current }))[0];
}
export function useEffect(effect, deps) {
  const host = active;
  const index = host.cursor++;
  const previous = host.slots[index];
  if (previous && deps.every((value, i) => Object.is(value, previous.deps[i])))
    return;
  host.effects.push(() => {
    previous?.cleanup?.();
    host.slots[index] = { deps, cleanup: effect() };
  });
}
export const jsx = (type, props, key) => ({ type, props, key });
export const jsxs = jsx;
export const Fragment = "Fragment";
export const List = Object.assign("List", {
  Item: { Detail: "Detail" },
  EmptyView: "EmptyView",
  Dropdown: { Item: "Model", Section: "Models" },
});
export const Action = { Push: "Push", Paste: "Paste", CopyToClipboard: "Copy" };
export const ActionPanel = { Section: "Actions", Submenu: "Submenu" };
export const Icon = {};
export const Keyboard = { Shortcut: { Common: {} } };
export const Toast = { Style: { Failure: "failure" } };
export const showToast = async () => ({ hide() {} });
export const useNavigation = () => ({ push() {} });
export const ErrorActions = "ErrorActions";
export const OptionActions = "OptionActions";
export const STOP_SHORTCUT = {};
export const HistoryView = "HistoryView";
export const SettingsView = "SettingsView";
export const useLoadingIndicator = () => "⠋";
export const errorMarkdown = (error) => error.message;
export const footerMarkdown = () => "";
export const stepsMarkdown = (steps) => steps?.join("\n") || "";
export const currentModel = () => active.defaultModel;
export const availableModels = () => active.catalog.models;
export const providerOf = (model) => model.split(":")[0];
export const isNativeDefault = (model) => model.endsWith(":default");
export const modelsForProvider = (models, provider) =>
  models.filter((model) => providerOf(model.value) === provider);
export const matchingValue = (model, models) =>
  models.find((option) => option.value === model)?.value ?? "";
export const modelLabel = (model) => model;
export const groupByProvider = (models) => [{ provider: "codex", models }];
export const setCurrentModel = () => {};
export const defaultOptions = () => ({});
export const optionsForModel = (options) => options;
export const optionBadges = () => [];
export const PROVIDER_NAMES = { codex: "Codex", pi: "Pi Agent" };
export const enabledProviders = () => ["codex", "pi"];
export const getProviderSettings = () => ({ enabled: true });
export const getSettings = () => ({ general: { defaultProvider: "codex" } });
export const titleFrom = (question) => question;
export const saveConversation = async () => {};
export const newConversation = (model, options) => ({
  id: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  provider: providerOf(model),
  model,
  options,
  title: "",
  messages: [],
});
export const commandResultPrompt = () => "";
export const runApprovedCommand = async () => "";
export const useModels = () => active.catalog;
export const useModelStream = () => {
  const host = active;
  return {
    ...host.stream,
    run: (options) => {
      host.requests.push(options);
      host.stream.isLoading = true;
      host.dirty = true;
      return new Promise((resolve) => {
        host.finish = (text) => {
          host.stream = { isLoading: false, text };
          host.dirty = true;
          resolve({ text, isError: false });
        };
      });
    },
    stop() {},
  };
};
export function createHost(Component, props) {
  const host = {
    slots: [],
    effects: [],
    requests: [],
    frames: [],
    defaultModel: "codex:test",
    dirty: true,
    stream: { isLoading: false, text: "" },
    catalog: {
      isRefreshing: false,
      models: [
        { value: "codex:test", title: "Test" },
        { value: "codex:other", title: "Other" },
        { value: "pi:test", title: "Pi" },
      ],
    },
    render() {
      active = host;
      do {
        host.dirty = false;
        host.cursor = 0;
        host.tree = Component(props);
        host.frames.push(host.tree);
        host.effects.splice(0).forEach((effect) => effect());
      } while (host.dirty);
      return host.tree;
    },
    dispose() {
      host.slots.forEach((slot) => slot?.cleanup?.());
    },
  };
  return host;
}
