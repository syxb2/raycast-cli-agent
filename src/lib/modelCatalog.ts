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
import { Provider, providerOf } from "./provider";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
let pending: Promise<ModelCatalog> | undefined;

async function discover(force: boolean): Promise<ModelCatalog> {
  const base = await loadEnvironment();
  const providers: Provider[] = ["codex", "pi"];
  const fingerprint = providers
    .map((provider) => {
      const env = providerEnvironment(provider, base);
      const binary = resolveBinary(provider, env);
      return binary
        ? runtimeFingerprint(provider, binary, env)
        : `${provider}:missing`;
    })
    .join(":");
  const cached = loadCatalog();
  if (
    !force &&
    cached?.fingerprint === fingerprint &&
    Date.now() - cached.fetchedAt < MAX_AGE_MS
  )
    return cached;
  const results = await Promise.allSettled([
    fetchCodexModels(),
    fetchPiModels(),
  ]);
  const models = results.flatMap((result, i) =>
    result.status === "fulfilled"
      ? result.value
      : (cached?.models.filter((m) => providerOf(m.value) === providers[i]) ??
        []),
  );
  if (!models.length)
    throw new Error(
      "No models found. Install and configure Codex or Pi Agent.",
    );
  const catalog: ModelCatalog = {
    version: 2,
    fingerprint,
    fetchedAt: Date.now(),
    models,
  };
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
      setModels(availableModels());
    } catch {
      /* Keep local defaults and any cached model catalog. */
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { models, isRefreshing, refresh };
}
