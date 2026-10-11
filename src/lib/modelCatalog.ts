import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { useCallback, useEffect, useState } from "react";
import { childEnv, resolveClaudeBinary, workDir } from "./claude";
import {
  availableModels,
  loadCatalog,
  ModelCatalog,
  ModelOption,
  saveCatalog,
} from "./models";

const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;

interface CliModel {
  value: string;
  resolvedModel?: string;
  displayName?: string;
  description?: string;
}

// Claude Code'un kontrol protokolu (Agent SDK'nin supportedModels()'i de bunu
// kullanir): stream-json girdisine "initialize" istegi yazinca cevapta hesabin
// planina gore kullanilabilir modeller gelir. Model cagrisi yapilmaz, ~2 sn.
export function fetchCliModels(): Promise<ModelOption[]> {
  const bin = resolveClaudeBinary();
  if (!bin) return Promise.reject(new Error("Claude Code CLI bulunamadı."));

  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--no-session-persistence",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: workDir(),
      env: childEnv(),
      stdio: ["pipe", "pipe", "ignore"],
    });
    let settled = false;
    const finish = (err?: Error, models?: ModelOption[]) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill("SIGINT");
      if (err) reject(err);
      else resolve(models!);
    };
    const timer = setTimeout(
      () => finish(new Error("Model listesi zaman aşımına uğradı.")),
      TIMEOUT_MS,
    );

    createInterface({ input: child.stdout }).on("line", (line) => {
      let event: {
        type?: string;
        response?: { response?: { models?: CliModel[] } };
      };
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type !== "control_response") return;
      const models = event.response?.response?.models;
      if (!Array.isArray(models) || models.length === 0) {
        finish(new Error("CLI model listesi döndürmedi."));
        return;
      }
      finish(undefined, normalize(models));
    });
    child.on("error", (e) => finish(e));
    child.on("close", () =>
      finish(new Error("CLI model listesi vermeden kapandı.")),
    );

    // stdin acik kalmali: kapanirsa CLI cevabi yazmadan cikabiliyor.
    child.stdin.write(
      JSON.stringify({
        type: "control_request",
        request_id: "models",
        request: { subtype: "initialize" },
      }) + "\n",
    );
  });
}

// "default" yalnizca baska bir modelin takma adi; ayni modele cozulen
// girdilerden ilki (takma ad) tutulur.
function normalize(models: CliModel[]): ModelOption[] {
  const seen = new Set<string>();
  const out: ModelOption[] = [];
  for (const m of models) {
    if (!m.value || m.value === "default") continue;
    const resolved = m.resolvedModel ?? m.value;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push({
      title: m.displayName || m.value,
      value: m.value,
      description: m.description,
      resolvedModel: resolved,
    });
  }
  return out;
}

export async function refreshCatalog(
  force = false,
): Promise<ModelCatalog | undefined> {
  const cached = loadCatalog();
  if (!force && cached && Date.now() - cached.fetchedAt < MAX_AGE_MS)
    return cached;
  const models = await fetchCliModels();
  const catalog = { fetchedAt: Date.now(), models };
  saveCatalog(catalog);
  return catalog;
}

// Onbellekteki liste hemen gosterilir; eskiyse arka planda yenilenir.
export function useModels() {
  const [models, setModels] = useState<ModelOption[]>(availableModels);
  const [isRefreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      await refreshCatalog(force);
      setModels(availableModels());
    } catch {
      // CLI'ye ulasilamazsa onbellek/yedek liste kalir
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { models, isRefreshing, refresh };
}
