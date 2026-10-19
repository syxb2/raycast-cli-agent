import { currentModel } from "./models";
import { Provider, providerOf } from "./provider";

import {
  CLAUDE_EFFORTS,
  CODEX_EFFORTS,
  PI_THINKING_LEVELS,
  Effort,
  getProviderSettings,
} from "./settings";
export type { Effort } from "./settings";

export function effortsForProvider(
  provider: Provider,
): { value: Effort; title: string }[] {
  return (
    provider === "codex"
      ? CODEX_EFFORTS
      : provider === "claude"
        ? CLAUDE_EFFORTS
        : PI_THINKING_LEVELS
  ).map((value) => ({
    value,
    title:
      value === "xhigh"
        ? "Extra High"
        : value[0].toUpperCase() + value.slice(1),
  }));
}

// Per-request options. Tool permissions are always read from the agent settings.
export interface RequestOptions {
  webSearch?: boolean;
  effort?: Effort;
  // Finder context does not grant tools when the agent disables them.
  readDirs?: string[];
}

export function defaultOptions(model = currentModel()): RequestOptions {
  const provider = providerOf(model);
  return {
    webSearch:
      provider === "codex"
        ? getProviderSettings("codex").webSearch
        : provider === "claude"
          ? getProviderSettings("claude").webSearch
          : undefined,
    // Leave reasoning unset so the backend can resolve provider/model defaults.
  };
}

export function effortTitle(effort: Effort | undefined): string {
  return (
    effortsForProvider("pi").find((e) => e.value === effort)?.title ??
    "Provider Default"
  );
}

// Short markers for titles: "Web · Tools · High".
export function optionBadges(
  o: RequestOptions | undefined,
  model?: string,
): string[] {
  const badges: string[] = [];
  const settings = model ? getProviderSettings(providerOf(model)) : undefined;
  if (
    o?.webSearch ??
    (settings && "webSearch" in settings ? settings.webSearch : false)
  )
    badges.push("Web");
  const access = settings?.toolAccess ?? "none";
  if (access === "all") badges.push("All Tools");
  else if (access === "read-only") badges.push("Read-only Tools");
  if (o?.effort) badges.push(effortTitle(o.effort));
  return badges;
}

export function optionsForModel(
  options: RequestOptions,
  model: string,
): RequestOptions {
  const provider = providerOf(model);
  return {
    readDirs: options.readDirs,
    webSearch: provider === "pi" ? undefined : options.webSearch,
    effort: effortsForProvider(provider).some((e) => e.value === options.effort)
      ? options.effort
      : undefined,
  };
}
