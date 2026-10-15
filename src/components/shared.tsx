import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  openExtensionPreferences,
} from "@raycast/api";
import { spawn } from "node:child_process";
import { ModelError } from "../lib/types";
import { groupByProvider, ModelOption, sameModel } from "../lib/models";
import { EFFORTS, RequestOptions } from "../lib/options";
import { resolveCodexBinary } from "../lib/codex";
import { resolvePiBinary } from "../lib/pi";
import { Provider, PROVIDER_NAMES, providerOf } from "../lib/provider";

function loginCommand(provider: Provider | undefined): string {
  if (provider === "codex") {
    // Codex may only exist inside the ChatGPT app, so use the resolved path.
    return `'${(resolveCodexBinary() ?? "codex").replace(/'/g, "'\\''")}' login`;
  }
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
        title="Open Extension Preferences"
        icon={Icon.Gear}
        onAction={openExtensionPreferences}
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
  onRefresh: () => void;
}) {
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
              icon={
                sameModel(m.value, props.current) ? Icon.Checkmark : Icon.Circle
              }
              onAction={() => props.onSelect(m.value)}
            />
          ))}
        </ActionPanel.Section>
      ))}
      <ActionPanel.Section>
        <Action
          title="Refresh Model List"
          icon={Icon.ArrowClockwise}
          onAction={props.onRefresh}
        />
        <Action
          title="Add Extra Model…"
          icon={Icon.Plus}
          onAction={openExtensionPreferences}
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

// Web search, tools and effort for the current chat or answer.
export function OptionActions(props: {
  options: RequestOptions;
  onChange: (options: RequestOptions) => void;
  showTools?: boolean;
  model: string;
}) {
  const { options, onChange } = props;
  return (
    <ActionPanel.Section title="Options">
      {providerOf(props.model) === "codex" ? (
        <Action
          title={options.webSearch ? "Disable Web Search" : "Enable Web Search"}
          icon={Icon.Globe}
          shortcut={WEB_SEARCH_SHORTCUT}
          onAction={() =>
            onChange({ ...options, webSearch: !options.webSearch || undefined })
          }
        />
      ) : null}
      {props.showTools ? (
        <Action
          title={
            options.tools ? "Disable Tools" : "Enable Tools (Files and Shell)"
          }
          icon={Icon.Hammer}
          shortcut={TOOLS_SHORTCUT}
          onAction={() =>
            onChange({ ...options, tools: !options.tools || undefined })
          }
        />
      ) : null}
      <ActionPanel.Submenu
        title="Reasoning Effort"
        icon={Icon.LightBulb}
        shortcut={EFFORT_SHORTCUT}
      >
        <Action
          title="CLI Default"
          icon={options.effort ? Icon.Circle : Icon.Checkmark}
          onAction={() => onChange({ ...options, effort: undefined })}
        />
        {EFFORTS.map((e) => (
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
