import { environment } from "@raycast/api";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  PROVIDERS,
  nativeDefault,
  Provider,
  isSupportedModel,
  providerOf,
} from "./provider";

import {
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
  // Missing on legacy v4 catalogs; migrated when a provider next refreshes.
  providerFetchedAt?: Partial<Record<Provider, number>>;
}

const catalogListeners = new Set<() => void>();

export function subscribeCatalog(listener: () => void): () => void {
  catalogListeners.add(listener);
  return () => {
    catalogListeners.delete(listener);
  };
}

export function isNativeDefault(model: string): boolean {
  return isSupportedModel(model) && model === nativeDefault(providerOf(model));
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
  const snapshot = modelSnapshot();
  const settings = snapshot.settings.providers[provider];
  if (!settings.enabled)
    throw new Error(
      `${provider} is disabled. Enable it in Cli Agent Settings.`,
    );
  const visible = snapshot.visible(provider);
  try {
    const saved = JSON.parse(
      readFileSync(supportFile("current-models.json"), "utf8"),
    )[provider];
    if (
      saved?.defaultModel === settings.defaultModel &&
      isSupportedModel(saved.model) &&
      providerOf(saved.model) === provider &&
      visible.some((m) => snapshot.same(m.value, saved.model))
    )
      return saved.model;
  } catch {
    /* No remembered model for this provider. */
  }
  return visible.some((m) => snapshot.same(m.value, settings.defaultModel))
    ? settings.defaultModel
    : (visible[0]?.value ?? nativeDefault(provider));
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
  const file = supportFile("models.json");
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(catalog), { mode: 0o600 });
  renameSync(temp, file);
  for (const listener of catalogListeners) listener();
}

// One catalog/settings snapshot per operation. Never read files inside model
// matching loops, and never resolve aliases from a different CLI configuration.
function modelSnapshot() {
  const catalog = loadCatalog();
  const settings = getSettings();
  const eligible = new Set(
    PROVIDERS.filter(
      (provider) =>
        catalog?.providerFingerprints[provider] ===
        providerFingerprint(provider, settings.providers[provider]),
    ),
  );
  const entries = (catalog?.models ?? []).filter((m) =>
    eligible.has(providerOf(m.value)),
  );
  const resolutions = new Map(
    entries.map((m) => [m.value, m.resolvedModel ?? m.value]),
  );
  const resolve = (model: string) => resolutions.get(model) ?? model;
  const same = (a: string, b: string) => a === b || resolve(a) === resolve(b);
  const label = (original: string) => {
    if (!isSupportedModel(original)) return original;
    const model = resolve(original);
    const provider = providerOf(model);
    const aliases = settings.providers[provider].modelAliases;
    const name =
      aliases[original] ||
      aliases[model] ||
      (isNativeDefault(model)
        ? "CLI default"
        : model.slice(provider.length + 1));
    return `${provider}: ${name}`;
  };
  const browser = (provider: Provider): ModelOption[] => {
    const list = entries.filter(
      (m) => providerOf(m.value) === provider && !isNativeDefault(m.value),
    );
    const seen = new Set(list.map((m) => resolve(m.value)));
    // Custom Codex/Claude IDs remain usable independently of discovery. Pi
    // selections always require its native authenticated model catalog.
    if (provider !== "pi") {
      for (const value of settings.providers[provider].customModels) {
        if (!isNativeDefault(value) && !seen.has(resolve(value))) {
          list.push({ value, title: label(value) });
          seen.add(resolve(value));
        }
      }
    }
    return list.map((m) => ({ ...m, title: label(m.value) }));
  };
  const visible = (provider: Provider) => {
    const indexed = new Map<string, ModelOption>();
    for (const model of browser(provider))
      if (!indexed.has(resolve(model.value)))
        indexed.set(resolve(model.value), model);
    const result: ModelOption[] = [];
    const seen = new Set<string>();
    for (const id of settings.providers[provider].visibleModels ?? []) {
      const model = indexed.get(resolve(id));
      if (model && !seen.has(model.value)) {
        result.push(model);
        seen.add(model.value);
      }
    }
    return result;
  };
  return { settings, resolve, same, label, browser, visible };
}

export function resolvedModel(model: string): string {
  return modelSnapshot().resolve(model);
}

// Resolved aliases can share one selected catalog entry.
export function sameModel(a: string, b: string): boolean {
  if (a === b) return true;
  return modelSnapshot().same(a, b);
}

export function modelLabel(model: string): string {
  return modelSnapshot().label(model);
}

export function browserModels(provider: Provider): ModelOption[] {
  return modelSnapshot().browser(provider);
}

export function visibleProviderModels(provider: Provider): ModelOption[] {
  return modelSnapshot().visible(provider);
}

export function setVisibleModels(provider: Provider, ids: string[]): void {
  const selected = [...new Set(ids)];
  const current = getProviderSettings(provider).defaultModel;
  const defaultModel =
    selected[0] && sameModel(selected[0], current)
      ? current
      : (selected[0] ?? nativeDefault(provider));
  updateProviderSettings(provider, { visibleModels: selected, defaultModel });
}

export function availableModels(): ModelOption[] {
  const snapshot = modelSnapshot();
  return PROVIDERS.filter(
    (p) => snapshot.settings.providers[p].enabled,
  ).flatMap(snapshot.visible);
}

// The list entry matching the current model, so dropdowns show it as selected.
export function matchingValue(model: string, list: ModelOption[]): string {
  if (list.some((m) => m.value === model)) return model;
  const snapshot = modelSnapshot();
  return list.find((m) => snapshot.same(m.value, model))?.value ?? "";
}

// Groups models by the native CLI that owns them.
export function groupByProvider(
  models: ModelOption[],
  preferred?: string,
): { provider: Provider; models: ModelOption[] }[] {
  return PROVIDERS.map((provider) => ({
    provider,
    models: models
      .filter((m) => providerOf(m.value) === provider)
      .sort(
        (a, b) => Number(b.value === preferred) - Number(a.value === preferred),
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
