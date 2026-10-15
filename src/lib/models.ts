import { environment, getPreferenceValues } from "@raycast/api";
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

export interface ModelOption {
  title: string;
  value: string;
  description?: string;
  // Full model id an alias (opus, haiku) currently resolves to.
  resolvedModel?: string;
}

export interface ModelCatalog {
  version: 2;
  fingerprint: string;
  fetchedAt: number;
  models: ModelOption[];
}

// Default selections preserve each CLI's local model and provider settings.
export const FALLBACK_MODELS: ModelOption[] = [
  { title: "Codex (local configuration)", value: CODEX_DEFAULT },
  { title: "Pi (local configuration)", value: PI_DEFAULT },
];

function supportFile(name: string): string {
  mkdirSync(environment.supportPath, { recursive: true });
  return join(environment.supportPath, name);
}

// The last chosen model is shared by all commands and persists. Stored in a
// small file because LocalStorage is async and this is read synchronously.
export function currentModel(): string {
  try {
    const saved = readFileSync(supportFile("current-model"), "utf8").trim();
    if (isSupportedModel(saved)) return saved;
  } catch {
    // nothing chosen yet
  }
  const configured = getPreferenceValues<Preferences>().model;
  return configured && isSupportedModel(configured)
    ? configured
    : CODEX_DEFAULT;
}

export function setCurrentModel(model: string): void {
  writeFileSync(supportFile("current-model"), model);
}

export function loadCatalog(): ModelCatalog | undefined {
  try {
    const catalog = JSON.parse(
      readFileSync(supportFile("models.json"), "utf8"),
    );
    return catalog.version === 2 ? catalog : undefined;
  } catch {
    return undefined;
  }
}

export function saveCatalog(catalog: ModelCatalog): void {
  writeFileSync(supportFile("models.json"), JSON.stringify(catalog));
}

// Resolved aliases can share one selected catalog entry.
export function sameModel(a: string, b: string): boolean {
  if (a === b) return true;
  const models = loadCatalog()?.models ?? [];
  const resolve = (v: string) =>
    models.find((m) => m.value === v)?.resolvedModel ?? v;
  return resolve(a) === resolve(b);
}

export function modelLabel(model: string): string {
  const known = loadCatalog()?.models.find((m) => m.value === model);
  if (known) return known.title;
  if (model === CODEX_DEFAULT) return "Codex (local configuration)";
  if (model === PI_DEFAULT) return "Pi (local configuration)";
  if (!isSupportedModel(model)) return model;
  return model.slice(
    providerOf(model) === "codex" ? CODEX_PREFIX.length : PI_PREFIX.length,
  );
}

// CLI list (or fallback) + Extra Models preference + the current model if missing.
export function availableModels(): ModelOption[] {
  const list = [...(loadCatalog()?.models ?? FALLBACK_MODELS)];
  const custom = (getPreferenceValues<Preferences>().customModels ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((model) =>
      isSupportedModel(model) ? model : `${CODEX_PREFIX}${model}`,
    );
  for (const value of [...custom, currentModel()]) {
    if (!list.some((m) => sameModel(m.value, value))) {
      list.push({ title: modelLabel(value), value });
    }
  }
  return list;
}

// The list entry matching the current model, so dropdowns show it as selected.
export function matchingValue(model: string, list: ModelOption[]): string {
  return list.find((m) => sameModel(m.value, model))?.value ?? model;
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
  const list = models.filter((m) => providerOf(m.value) === provider);
  if (
    current &&
    providerOf(current) === provider &&
    !list.some((m) => sameModel(m.value, current))
  ) {
    list.push({ value: current, title: modelLabel(current) });
  }
  return list;
}
