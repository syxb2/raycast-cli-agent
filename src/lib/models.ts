import { environment } from "@raycast/api";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODEX_DEFAULT,
  CODEX_PREFIX,
  PI_DEFAULT,
  PI_PREFIX,
  Provider,
  isSupportedModel,
  providerOf,
} from "./provider";

import { enabledProviders, getProviderSettings, getSettings } from "./settings";

export interface ModelOption {
  title: string;
  value: string;
  description?: string;
  // Full model id an alias (opus, haiku) currently resolves to.
  resolvedModel?: string;
}

export interface ModelCatalog {
  version: 3;
  fingerprint: string;
  fetchedAt: number;
  models: ModelOption[];
  errors?: Partial<Record<Provider, string>>;
}

export function isNativeDefault(model: string): boolean {
  return model === CODEX_DEFAULT || model === PI_DEFAULT;
}

function supportFile(name: string): string {
  mkdirSync(environment.supportPath, { recursive: true });
  return join(environment.supportPath, name);
}

// Remember model choices independently; changing one provider's default invalidates
// its previous choice without affecting another provider.
export function currentModel(
  provider: Provider = getSettings().general.defaultProvider,
): string {
  const settings = getProviderSettings(provider);
  if (!settings.enabled)
    throw new Error(
      `${provider} is disabled. Enable it in Cli Agent Settings.`,
    );
  try {
    const saved = JSON.parse(
      readFileSync(supportFile("current-models.json"), "utf8"),
    )[provider];
    if (
      saved?.defaultModel === settings.defaultModel &&
      isSupportedModel(saved.model) &&
      providerOf(saved.model) === provider &&
      (settings.visibleModels === null ||
        settings.visibleModels.includes(saved.model) ||
        saved.model === settings.defaultModel)
    )
      return saved.model;
  } catch {
    /* No remembered model for this provider. */
  }
  return settings.defaultModel;
}

export function setCurrentModel(model: string): void {
  const provider = providerOf(model);
  const settings = getProviderSettings(provider);
  if (!settings.enabled)
    throw new Error(
      `${provider} is disabled. Enable it in Cli Agent Settings.`,
    );
  let saved: Record<string, { model: string; defaultModel: string }> = {};
  try {
    saved = JSON.parse(
      readFileSync(supportFile("current-models.json"), "utf8"),
    );
  } catch {
    /* First model choice. */
  }
  saved[provider] = { model, defaultModel: settings.defaultModel };
  writeFileSync(supportFile("current-models.json"), JSON.stringify(saved), {
    mode: 0o600,
  });
  // The standalone Spotlight helper uses the most recently selected model.
  writeFileSync(supportFile("current-model"), model);
}

export function loadCatalog(): ModelCatalog | undefined {
  try {
    const catalog = JSON.parse(
      readFileSync(supportFile("models.json"), "utf8"),
    );
    return catalog.version === 3 ? catalog : undefined;
  } catch {
    return undefined;
  }
}

export function saveCatalog(catalog: ModelCatalog): void {
  writeFileSync(supportFile("models.json"), JSON.stringify(catalog));
}

export function resolvedModel(model: string): string {
  return (
    loadCatalog()?.models.find((m) => m.value === model)?.resolvedModel ?? model
  );
}

// Resolved aliases can share one selected catalog entry.
export function sameModel(a: string, b: string): boolean {
  if (a === b) return true;
  return resolvedModel(a) === resolvedModel(b);
}

export function modelLabel(model: string): string {
  if (!isSupportedModel(model)) return model;
  model = resolvedModel(model);
  const provider = providerOf(model);
  const alias = getProviderSettings(provider).modelAliases[model];
  const name =
    alias ||
    (isNativeDefault(model)
      ? "CLI default"
      : model.slice(
          provider === "codex" ? CODEX_PREFIX.length : PI_PREFIX.length,
        ));
  return `${provider}: ${name}`;
}

export function availableModels(): ModelOption[] {
  const catalog = loadCatalog()?.models ?? [];
  return enabledProviders().flatMap((provider) => {
    const settings = getProviderSettings(provider);
    const list = catalog.filter(
      (m) => providerOf(m.value) === provider && !isNativeDefault(m.value),
    );
    const nativeDefault = provider === "codex" ? CODEX_DEFAULT : PI_DEFAULT;
    for (const model of [
      nativeDefault,
      ...settings.customModels,
      settings.defaultModel,
      currentModel(provider),
    ]) {
      const value = resolvedModel(model);
      if (isNativeDefault(value)) continue;
      if (!list.some((m) => m.value === value))
        list.push({ value, title: modelLabel(value) });
    }
    return list
      .filter(
        (m) =>
          settings.visibleModels === null ||
          settings.visibleModels.some((value) => sameModel(value, m.value)) ||
          sameModel(m.value, settings.defaultModel),
      )
      .map((m) => ({
        ...m,
        title: modelLabel(m.value),
      }));
  });
}

// The list entry matching the current model, so dropdowns show it as selected.
export function matchingValue(model: string, list: ModelOption[]): string {
  return (
    list.find((m) => sameModel(m.value, model))?.value ??
    (isNativeDefault(model) ? "" : model)
  );
}

// Groups models by the native CLI that owns them.
export function groupByProvider(
  models: ModelOption[],
): { provider: Provider; models: ModelOption[] }[] {
  return (["codex", "pi"] as Provider[])
    .map((provider) => ({
      provider,
      models: models.filter((m) => providerOf(m.value) === provider),
    }))
    .filter((g) => g.models.length > 0);
}

// Chats offer models only from their bound agent, including an older selection.
export function modelsForProvider(
  models: ModelOption[],
  provider: Provider,
  current?: string,
): ModelOption[] {
  const list = models.filter(
    (m) => providerOf(m.value) === provider && !isNativeDefault(m.value),
  );
  current = current && resolvedModel(current);
  if (
    current &&
    !isNativeDefault(current) &&
    providerOf(current) === provider &&
    !list.some((m) => sameModel(m.value, current))
  ) {
    list.push({ value: current, title: modelLabel(current) });
  }
  return list;
}
