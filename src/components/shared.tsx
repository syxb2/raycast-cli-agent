import { Action, Icon, openExtensionPreferences } from "@raycast/api";
import { spawn } from "node:child_process";
import { ClaudeError } from "../lib/claude";

export const MODELS = [
  { title: "Haiku 5.5", value: "claude-haiku-5-5" },
  { title: "Sonnet 5.5", value: "claude-sonnet-5-5" },
  { title: "Opus 5.5", value: "claude-opus-5-5" },
];

function openLoginInTerminal() {
  spawn(
    "osascript",
    [
      "-e",
      'tell application "Terminal" to activate',
      "-e",
      'tell application "Terminal" to do script "claude /login"',
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  ).unref();
}

export function ErrorActions({ error }: { error: ClaudeError }) {
  if (error.kind === "not-logged-in") {
    return (
      <Action
        title="Terminalde Giriş Yap"
        icon={Icon.Terminal}
        onAction={openLoginInTerminal}
      />
    );
  }
  if (error.kind === "not-installed") {
    return (
      <Action
        title="Eklenti Ayarlarını Aç"
        icon={Icon.Gear}
        onAction={openExtensionPreferences}
      />
    );
  }
  return null;
}
