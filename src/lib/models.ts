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

import {
  enabledProviders,
  getProviderSettings,
  getSettings,
  updateProviderSettings,
} from "./settings";
import { providerFingerprint } from "./backend/environment";

export interface ModelOption {
  title: string;
  value: string;
  description?: string;
  // Full model id an alias (opus, haiku) currently resolves to.
  resolvedModel?: string;
}

export interface ModelCatalog {
  version: 4;
  fingerprint: string;
  fetchedAt: number;
  models: ModelOption[];
  errors?: Partial<Record<Provider, string>>;
  providerFingerprints: Partial<Record<Provider, string>>;
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
      visibleProviderModels(provider).some((m) =>
        sameModel(m.value, saved.model),
      )
    )
      return saved.model;
  } catch {
    /* No remembered model for this provider. */
  }
  const visible = visibleProviderModels(provider);
  return visible.some((m) => sameModel(m.value, settings.defaultModel))
    ? settings.defaultModel
    : (visible[0]?.value ??
        (provider === "codex" ? CODEX_DEFAULT : PI_DEFAULT));
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
    return catalog.version === 4 ? catalog : undefined;
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

export function browserModels(provider: Provider): ModelOption[] {
  const catalog = loadCatalog();
  if (
    provider === "pi" &&
    catalog?.providerFingerprints.pi !== providerFingerprint("pi")
  )
    return [];
  const list = (catalog?.models ?? []).filter(
    (m) => providerOf(m.value) === provider && !isNativeDefault(m.value),
  );
  // Codex accepts custom IDs without a catalog endpoint. Pi models must be
  // returned by its native authenticated discovery, even when entered manually.
  if (provider === "codex") {
    for (const value of getProviderSettings(provider).customModels) {
      if (!list.some((m) => m.value === value))
        list.push({ value, title: modelLabel(value) });
    }
  }
  return list.map((m) => ({ ...m, title: modelLabel(m.value) }));
}

export function visibleProviderModels(provider: Provider): ModelOption[] {
  const models = browserModels(provider);
  const selected = getProviderSettings(provider).visibleModels ?? [];
  return selected.flatMap((id) => {
    const model = models.find((m) => sameModel(m.value, id));
    return model ? [model] : [];
  });
}

export function setVisibleModels(provider: Provider, ids: string[]): void {
  const selected = [...new Set(ids)];
  const current = getProviderSettings(provider).defaultModel;
  const defaultModel =
    selected[0] && sameModel(selected[0], current)
      ? current
      : (selected[0] ?? (provider === "codex" ? CODEX_DEFAULT : PI_DEFAULT));
  updateProviderSettings(provider, { visibleModels: selected, defaultModel });
}

export function availableModels(): ModelOption[] {
  return enabledProviders().flatMap(visibleProviderModels);
}

// The list entry matching the current model, so dropdowns show it as selected.
export function matchingValue(model: string, list: ModelOption[]): string {
  return list.find((m) => sameModel(m.value, model))?.value ?? "";
}

// Groups models by the native CLI that owns them.
export function groupByProvider(
  models: ModelOption[],
  preferred?: string,
): { provider: Provider; models: ModelOption[] }[] {
  return (["codex", "pi"] as Provider[])
    .map((provider) => ({
      provider,
      models: models
        .filter((m) => providerOf(m.value) === provider)
        .sort(
          (a, b) =>
            Number(b.value === preferred) - Number(a.value === preferred),
        ),
    }))
    .filter((g) => g.models.length > 0)
    .sort(
      (a, b) =>
        Number(b.models.some((m) => m.value === preferred)) -
        Number(a.models.some((m) => m.value === preferred)),
    );
}

// Hidden or unavailable selections remain in history, never in the model menu.
export function modelsForProvider(
  models: ModelOption[],
  provider: Provider,
): ModelOption[] {
  const list = models.filter(
    (m) => providerOf(m.value) === provider && !isNativeDefault(m.value),
  );
  return list;
}
