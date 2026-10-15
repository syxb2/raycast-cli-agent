import { useCallback, useEffect, useState } from "react";
import { fetchCodexModels } from "./codex";
import { fetchPiModels } from "./pi";
import {
  availableModels,
  loadCatalog,
  ModelCatalog,
  saveCatalog,
} from "./models";
import {
  loadEnvironment,
  providerEnvironment,
  resolveBinary,
  runtimeFingerprint,
} from "./backend/environment";
import { getProviderSettings } from "./settings";
import { Provider, providerOf } from "./provider";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
let pending: Promise<ModelCatalog> | undefined;

async function fingerprint(): Promise<string> {
  const base = await loadEnvironment();
  return (["codex", "pi"] as const)
    .map((provider) => {
      if (!getProviderSettings(provider).enabled) return `${provider}:disabled`;
      const env = providerEnvironment(provider, base);
      const binary = resolveBinary(provider, env);
      return binary
        ? runtimeFingerprint(provider, binary, env)
        : `${provider}:missing`;
    })
    .join(":");
}

async function discover(force: boolean): Promise<ModelCatalog> {
  const key = await fingerprint();
  const cached = loadCatalog();
  if (
    !force &&
    cached?.fingerprint === key &&
    Date.now() - cached.fetchedAt < MAX_AGE_MS
  )
    return cached;
  const providers: Provider[] = ["codex", "pi"];
  const results = await Promise.allSettled([
    getProviderSettings("codex").enabled
      ? fetchCodexModels()
      : Promise.resolve([]),
    getProviderSettings("pi").enabled ? fetchPiModels() : Promise.resolve([]),
  ]);
  const models = results.flatMap((result, i) =>
    result.status === "fulfilled"
      ? result.value
      : (cached?.models.filter((m) => providerOf(m.value) === providers[i]) ??
        []),
  );
  if (!models.length)
    throw new Error(
      "No models found. Configure an enabled provider in Cli Agent Settings.",
    );
  if ((await fingerprint()) !== key)
    throw new Error(
      "Provider configuration changed during discovery. Refresh models again.",
    );
  const catalog: ModelCatalog = {
    version: 2,
    fingerprint: key,
    fetchedAt: Date.now(),
    models,
  };
  saveCatalog(catalog);
  return catalog;
}

export async function refreshProviderCatalog(
  provider: Provider,
): Promise<ModelCatalog> {
  if (!getProviderSettings(provider).enabled)
    throw new Error(`Enable ${provider} before discovering its models.`);
  const key = await fingerprint();
  const models = await (provider === "codex"
    ? fetchCodexModels()
    : fetchPiModels());
  if ((await fingerprint()) !== key)
    throw new Error(
      "Provider configuration changed during discovery. Refresh models again.",
    );
  const catalog: ModelCatalog = {
    version: 2,
    fingerprint: "",
    fetchedAt: Date.now(),
    models: [
      ...(loadCatalog()?.models.filter(
        (m) => providerOf(m.value) !== provider,
      ) ?? []),
      ...models,
    ],
  };
  // A provider-only refresh does not mark another provider's catalog as fresh.
  saveCatalog(catalog);
  return catalog;
}

export function refreshCatalog(force = false): Promise<ModelCatalog> {
  if (pending) return pending;
  const refresh = discover(force);
  pending = refresh;
  void refresh
    .finally(() => {
      if (pending === refresh) pending = undefined;
    })
    .catch(() => {});
  return refresh;
}

export function useModels() {
  const [models, setModels] = useState(availableModels);
  const [isRefreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      await refreshCatalog(force);
    } catch {
      /* Keep native defaults and the last available model catalog. */
    } finally {
      setModels(availableModels());
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { models, isRefreshing, refresh };
}
