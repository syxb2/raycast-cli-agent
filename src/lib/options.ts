import { currentModel } from "./models";
import { providerOf } from "./provider";

import {
  CODEX_EFFORTS,
  PI_THINKING_LEVELS,
  Effort,
  getProviderSettings,
} from "./settings";
export type { Effort } from "./settings";

export function effortsForProvider(
  provider: "codex" | "pi",
): { value: Effort; title: string }[] {
  return (provider === "codex" ? CODEX_EFFORTS : PI_THINKING_LEVELS).map(
    (value) => ({
      value,
      title:
        value === "xhigh"
          ? "Extra High"
          : value[0].toUpperCase() + value.slice(1),
    }),
  );
}

// What a request may use beyond plain text. Everything is off by default:
// each one makes answers slower and requests bigger.
export interface RequestOptions {
  webSearch?: boolean;
  effort?: Effort;
  // Read files anywhere in the home folder and propose shell commands, which
  // run only after the user approves them.
  tools?: boolean;
  // Folders that may be read (Finder selection), without shell commands.
  readDirs?: string[];
}

export function defaultOptions(model = currentModel()): RequestOptions {
  const provider = providerOf(model);
  const settings = getProviderSettings(provider);
  return {
    webSearch:
      provider === "codex"
        ? getProviderSettings("codex").webSearch || undefined
        : undefined,
    // Leave reasoning unset so the backend can resolve provider/model defaults.
    tools: settings.tools || undefined,
  };
}

export function effortTitle(effort: Effort | undefined): string {
  return (
    effortsForProvider("pi").find((e) => e.value === effort)?.title ??
    "Provider Default"
  );
}

// Short markers for titles: "Web · Tools · High".
export function optionBadges(o: RequestOptions | undefined): string[] {
  const badges: string[] = [];
  if (o?.webSearch) badges.push("Web");
  if (o?.tools) badges.push("Tools");
  if (o?.effort) badges.push(effortTitle(o.effort));
  return badges;
}

export function optionsForModel(
  options: RequestOptions,
  model: string,
): RequestOptions {
  return providerOf(model) === "pi"
    ? { ...options, webSearch: undefined }
    : options;
}
