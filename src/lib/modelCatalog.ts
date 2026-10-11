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

// Claude Code's control protocol (also behind the Agent SDK's
// supportedModels()): an "initialize" request on stream-json input returns the
// models available on the account's plan. No model call, ~1-2 s.
export function fetchCliModels(): Promise<ModelOption[]> {
  const bin = resolveClaudeBinary();
  if (!bin) return Promise.reject(new Error("Claude Code CLI not found."));

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
      () => finish(new Error("Timed out fetching the model list.")),
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
        finish(new Error("The CLI returned no model list."));
        return;
      }
      finish(undefined, normalize(models));
    });
    child.on("error", (e) => finish(e));
    child.on("close", () =>
      finish(new Error("The CLI exited before returning a model list.")),
    );

    // Keep stdin open: closing it can make the CLI exit before replying.
    child.stdin.write(
      JSON.stringify({
        type: "control_request",
        request_id: "models",
        request: { subtype: "initialize" },
      }) + "\n",
    );
  });
}

// "default" is only an alias of another model; among entries resolving to the
// same model the first one (the alias) is kept.
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

// The cached list shows immediately and is refreshed in the background when stale.
export function useModels() {
  const [models, setModels] = useState<ModelOption[]>(availableModels);
  const [isRefreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setRefreshing(true);
    try {
      await refreshCatalog(force);
      setModels(availableModels());
    } catch {
      // keep the cached/fallback list if the CLI is unreachable
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { models, isRefreshing, refresh };
}
