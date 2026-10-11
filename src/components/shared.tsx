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
import { resolveCodexBinary } from "../lib/codex";
import { Provider, PROVIDER_NAMES } from "../lib/provider";

function loginCommand(provider: Provider | undefined): string {
  if (provider === "codex") {
    // Codex may only exist inside the ChatGPT app, so use the resolved path.
    return `'${resolveCodexBinary() ?? "codex"}' login`;
  }
  return "claude /login";
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
