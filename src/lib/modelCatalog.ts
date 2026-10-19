import { useCallback, useEffect, useRef, useState } from "react";
import { showToast, Toast } from "@raycast/api";
import { fetchCodexModels } from "./codex";
import { fetchPiModels } from "./pi";
import { fetchClaudeModels } from "./claude";
import {
  availableModels,
  loadCatalog,
  ModelCatalog,
  saveCatalog,
  subscribeCatalog,
} from "./models";
import { loadEnvironment, providerFingerprint } from "./backend/environment";
import { getProviderSettings, updateProviderSettings } from "./settings";
import { Provider, PROVIDERS, providerOf } from "./provider";

const fetchProviderModels = (provider: Provider) =>
  ({
    codex: fetchCodexModels,
    pi: fetchPiModels,
    claude: fetchClaudeModels,
  })[provider]();

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
interface Discovery {
  key: string;
  promise: Promise<void>;
}
const pending = new Map<Provider, Discovery>();
class ProviderDiscoveryError extends Error {}

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

// Legacy complete catalogs can retain their original freshness. A legacy
// provider-only write never established freshness for the remaining providers.
function fetchedTimes(catalog?: ModelCatalog) {
  if (catalog?.providerFetchedAt) return { ...catalog.providerFetchedAt };
  return Object.fromEntries(
    PROVIDERS.flatMap((provider) =>
      catalog?.fingerprint &&
      catalog.providerFingerprints[provider] &&
      !catalog.errors?.[provider]
        ? [[provider, catalog.fetchedAt]]
        : [],
    ),
  ) as Partial<Record<Provider, number>>;
}

function isFresh(
  catalog: ModelCatalog | undefined,
  provider: Provider,
  key: string,
) {
  const fetchedAt = fetchedTimes(catalog)[provider];
  return Boolean(
    catalog?.providerFingerprints[provider] === key &&
    !catalog?.errors?.[provider] &&
    fetchedAt &&
    Date.now() - fetchedAt < MAX_AGE_MS,
  );
}

function initializeVisibility(
  provider: Provider,
  models: ModelCatalog["models"],
): void {
  const settings = getProviderSettings(provider);
  if (settings.visibleModels !== null) return;
  const own = models.filter((m) => providerOf(m.value) === provider);
  const actual = own.filter((m) => !m.value.endsWith(":default"));
  const nativeDefault = own.find((m) =>
    m.value.endsWith(":default"),
  )?.resolvedModel;
  const selected =
    actual.find(
      (m) =>
        m.value === settings.defaultModel ||
        m.value === nativeDefault ||
        m.resolvedModel === nativeDefault,
    ) ?? actual[0];
  if (selected)
    updateProviderSettings(provider, { visibleModels: [selected.value] });
}

// All callers share actual discoveries per provider/runtime. Cached reads are
// never placed in this map, so they cannot swallow a subsequent forced refresh.
async function refreshOne(provider: Provider, force: boolean): Promise<void> {
  await loadEnvironment();
  if (!getProviderSettings(provider).enabled)
    throw new Error(`Enable ${provider} before discovering its models.`);
  const key = providerFingerprint(provider);
  const running = pending.get(provider);
  if (running?.key === key) return running.promise;
  if (!force && isFresh(loadCatalog(), provider, key)) return;

  const discovery: Discovery = { key, promise: Promise.resolve() };
  const task = (async () => {
    let models: ModelCatalog["models"] = [];
    let failure: unknown;
    let failed = false;
    try {
      models = await fetchProviderModels(provider);
    } catch (error) {
      failed = true;
      failure = error;
    }
    if (
      pending.get(provider) !== discovery ||
      !getProviderSettings(provider).enabled ||
      providerFingerprint(provider) !== key
    )
      throw new Error(
        "Provider configuration changed during discovery. Refresh models again.",
      );

    // Merge only this provider into the latest document, never the snapshot
    // from when a full refresh began. Other providers may already have settled.
    const latest = loadCatalog();
    const sameRuntime = latest?.providerFingerprints[provider] === key;
    const errors = { ...latest?.errors };
    const providerFetchedAt = fetchedTimes(latest);
    if (failed) {
      errors[provider] = messageOf(failure);
      models = sameRuntime
        ? latest!.models.filter((m) => providerOf(m.value) === provider)
        : [];
      if (!sameRuntime) delete providerFetchedAt[provider];
    } else {
      delete errors[provider];
      providerFetchedAt[provider] = Date.now();
      initializeVisibility(provider, models);
    }
    const catalog: ModelCatalog = {
      version: 4,
      fingerprint: "",
      fetchedAt: Math.max(0, ...Object.values(providerFetchedAt)),
      models: [
        ...(latest?.models.filter((m) => providerOf(m.value) !== provider) ??
          []),
        ...models,
      ],
      errors,
      providerFingerprints: {
        ...latest?.providerFingerprints,
        [provider]: key,
      },
      providerFetchedAt,
    };
    if (
      PROVIDERS.every(
        (p) =>
          !getProviderSettings(p).enabled ||
          isFresh(catalog, p, providerFingerprint(p)),
      )
    )
      catalog.fingerprint = PROVIDERS.map((p) =>
        getProviderSettings(p).enabled
          ? providerFingerprint(p)
          : `${p}:disabled`,
      ).join(":");
    saveCatalog(catalog);
    if (failed)
      throw new ProviderDiscoveryError(messageOf(failure), { cause: failure });
  })();
  discovery.promise = task;
  pending.set(provider, discovery);
  try {
    await task;
  } finally {
    if (pending.get(provider) === discovery) pending.delete(provider);
  }
}

export async function refreshProviderCatalog(
  provider: Provider,
  force = true,
): Promise<ModelCatalog> {
  await refreshOne(provider, force);
  return loadCatalog()!;
}

export async function refreshCatalog(force = false): Promise<ModelCatalog> {
  const providers = PROVIDERS.filter((p) => getProviderSettings(p).enabled);
  const results = await Promise.allSettled(
    providers.map((p) => refreshOne(p, force)),
  );
  // Discovery errors already persisted above are returned with the catalog.
  // Configuration changes and storage failures still reject the whole refresh.
  const unexpected = results.find(
    (result) =>
      result.status === "rejected" &&
      !(result.reason instanceof ProviderDiscoveryError),
  );
  if (unexpected?.status === "rejected") throw unexpected.reason;
  const catalog = loadCatalog();
  if (!catalog?.models.some((m) => providers.includes(providerOf(m.value)))) {
    const failures = results.flatMap((result, i) =>
      result.status === "rejected"
        ? [`${providers[i]}: ${messageOf(result.reason)}`]
        : [],
    );
    throw new Error(
      [
        "No models found. Configure an enabled provider in Cli Agent Settings.",
        ...failures,
      ].join("\n"),
    );
  }
  return catalog;
}

function catalogErrors(catalog?: ModelCatalog): string {
  return Object.entries(catalog?.errors ?? {})
    .filter(([provider]) => getProviderSettings(provider as Provider).enabled)
    .map(([provider, message]) => `${provider}: ${message}`)
    .join("\n");
}

export function useModels() {
  const [models, setModels] = useState(availableModels);
  const [isRefreshing, setRefreshing] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(0);
  const refresh = useCallback(async (force = false) => {
    const id = ++request.current;
    setRefreshing(true);
    try {
      // Validate cached Pi eligibility with the inherited shell environment
      // before waiting for discovery of every enabled provider.
      await loadEnvironment();
      if (id !== request.current) return;
      setModels(availableModels());
      const catalog = await refreshCatalog(force);
      if (id !== request.current) return;
      const failures = catalogErrors(catalog);
      setError(failures);
      if (failures)
        await showToast({
          style: Toast.Style.Failure,
          title: "Some models could not be loaded",
          message: failures,
        });
    } catch (error) {
      if (id !== request.current) return;
      const message = messageOf(error);
      setError(message);
      await showToast({
        style: Toast.Style.Failure,
        title: "Models could not be loaded",
        message,
      });
    } finally {
      if (id === request.current) {
        setModels(availableModels());
        setRefreshing(false);
      }
    }
  }, []);
  useEffect(() => {
    const unsubscribe = subscribeCatalog(() => {
      setModels(availableModels());
      setError(catalogErrors(loadCatalog()));
    });
    void refresh();
    return () => {
      request.current++;
      unsubscribe();
    };
  }, [refresh]);
  return { models, isRefreshing, refresh, error };
}
