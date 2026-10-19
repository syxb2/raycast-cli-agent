import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  useNavigation,
} from "@raycast/api";
import { spawn } from "node:child_process";
import { ModelError } from "../lib/types";
import { groupByProvider, ModelOption, matchingValue } from "../lib/models";
import { effortsForProvider, RequestOptions } from "../lib/options";
import { resolveCodexBinary } from "../lib/codex";
import { resolveClaudeBinary } from "../lib/claude";
import { resolvePiBinary } from "../lib/pi";
import { SettingsView } from "./SettingsView";
import { Provider, PROVIDER_NAMES, providerOf } from "../lib/provider";
import {
  getProviderSettings,
  TOOL_ACCESS_OPTIONS,
  updateProviderSettings,
} from "../lib/settings";

function loginCommand(provider: Provider | undefined): string {
  if (provider === "codex") {
    // Codex may only exist inside the ChatGPT app, so use the resolved path.
    return `'${(resolveCodexBinary() ?? "codex").replace(/'/g, "'\\''")}' login`;
  }
  if (provider === "claude")
    return `'${(resolveClaudeBinary() ?? "claude").replace(/'/g, "'\\''")}' auth login`;
  return `'${(resolvePiBinary() ?? "pi").replace(/'/g, "'\\''")}'`;
}

function openLoginInTerminal(provider: Provider | undefined) {
  const script = `tell application "Terminal" to do script ${JSON.stringify(loginCommand(provider))}`;
  spawn(
    "osascript",
    ["-e", 'tell application "Terminal" to activate', "-e", script],
    {
      detached: true,
      stdio: "ignore",
    },
  ).unref();
}

export function ErrorActions({ error }: { error: ModelError }) {
  const { push } = useNavigation();
  if (error.kind === "not-logged-in") {
    return (
      <Action
        title="Open Terminal for Login"
        icon={Icon.Terminal}
        onAction={() => openLoginInTerminal(error.provider)}
      />
    );
  }
  if (error.kind === "not-installed") {
    return (
      <Action
        title="Open Cli Agent Settings"
        icon={Icon.Gear}
        onAction={() => push(<SettingsView />)}
      />
    );
  }
  return null;
}

export const STOP_SHORTCUT: Keyboard.Shortcut = {
  modifiers: ["cmd"],
  key: ".",
};
export const MODEL_SHORTCUT: Keyboard.Shortcut = {
  modifiers: ["cmd", "shift"],
  key: "r",
};

// The list comes from the CLI (useModels); the chosen model persists.
export function ModelSubmenu(props: {
  title: string;
  current: string;
  models: ModelOption[];
  onSelect: (model: string) => void;
  onRefresh: (force?: boolean) => void;
}) {
  const selected = matchingValue(props.current, props.models);
  return (
    <ActionPanel.Submenu
      title={props.title}
      icon={Icon.Switch}
      shortcut={MODEL_SHORTCUT}
    >
      {groupByProvider(props.models).map((g) => (
        <ActionPanel.Section
          key={g.provider}
          title={PROVIDER_NAMES[g.provider]}
        >
          {g.models.map((m) => (
            <Action
              key={m.value}
              title={m.title}
              icon={m.value === selected ? Icon.Checkmark : Icon.Circle}
              onAction={() => props.onSelect(m.value)}
            />
          ))}
        </ActionPanel.Section>
      ))}
      <ActionPanel.Section>
        <Action
          title="Refresh Model List"
          icon={Icon.ArrowClockwise}
          onAction={() => props.onRefresh(true)}
        />
        <Action.Push
          title="Provider Settings…"
          icon={Icon.Gear}
          target={<SettingsView />}
          onPop={() => queueMicrotask(props.onRefresh)}
        />
      </ActionPanel.Section>
    </ActionPanel.Submenu>
  );
}

export const WEB_SEARCH_SHORTCUT: Keyboard.Shortcut = {
  modifiers: ["cmd", "shift"],
  key: "w",
};
export const TOOLS_SHORTCUT: Keyboard.Shortcut = {
  modifiers: ["cmd", "shift"],
  key: "t",
};
export const EFFORT_SHORTCUT: Keyboard.Shortcut = {
  modifiers: ["cmd", "shift"],
  key: "e",
};

// Web search and effort belong to this request; tool access belongs to its agent.
export function OptionActions(props: {
  options: RequestOptions;
  onChange: (options: RequestOptions) => void;
  model: string;
}) {
  const { options, onChange } = props;
  const provider = providerOf(props.model);
  const settings = getProviderSettings(provider);
  const access = settings.toolAccess;
  const webSearch =
    options.webSearch ?? ("webSearch" in settings ? settings.webSearch : false);
  return (
    <ActionPanel.Section title="Options">
      {provider !== "pi" ? (
        <Action
          title={webSearch ? "Disable Web Search" : "Enable Web Search"}
          icon={Icon.Globe}
          shortcut={WEB_SEARCH_SHORTCUT}
          onAction={() => onChange({ ...options, webSearch: !webSearch })}
        />
      ) : null}
      <ActionPanel.Submenu
        title="Tool Permissions"
        icon={Icon.Hammer}
        shortcut={TOOLS_SHORTCUT}
      >
        {TOOL_ACCESS_OPTIONS.map(({ value, title }) => (
          <Action
            key={value}
            title={title}
            icon={access === value ? Icon.Checkmark : Icon.Circle}
            onAction={() => {
              if (value === access) return;
              updateProviderSettings(provider, { toolAccess: value });
              onChange({ ...options });
            }}
          />
        ))}
      </ActionPanel.Submenu>
      <ActionPanel.Submenu
        title="Reasoning Effort"
        icon={Icon.LightBulb}
        shortcut={EFFORT_SHORTCUT}
      >
        <Action
          title="Provider Default"
          icon={options.effort ? Icon.Circle : Icon.Checkmark}
          onAction={() => onChange({ ...options, effort: undefined })}
        />
        {effortsForProvider(providerOf(props.model)).map((e) => (
          <Action
            key={e.value}
            title={e.title}
            icon={options.effort === e.value ? Icon.Checkmark : Icon.Circle}
            onAction={() => onChange({ ...options, effort: e.value })}
          />
        ))}
      </ActionPanel.Submenu>
    </ActionPanel.Section>
  );
}
