import { codexModelId, CODEX_DEFAULT, CODEX_PREFIX } from "./provider";
import { getProviderSettings } from "./settings";
import { RunOptions, RunResult } from "./types";
import { codexCommandStep, codexWebStep } from "./steps";
import {
  configDirectory,
  loadEnvironment,
  providerEnvironment,
  resolveBinary,
  runtimeFingerprint,
  supportDirectory,
} from "./backend/environment";
import { JsonLineProcess, RecordValue, RpcError } from "./backend/rpc";
import {
  finishResult,
  instructions,
  splitCommands,
  usesReviewedCommands,
} from "./backend/result";
import { loadNativeSession, saveNativeSession } from "./backend/sessions";

export function resolveCodexBinary(): string | undefined {
  return resolveBinary("codex");
}

interface RuntimeEntry {
  process: JsonLineProcess;
  ready: Promise<void>;
  users: number;
  timer?: NodeJS.Timeout;
}

const runtimes = new Map<string, RuntimeEntry>();

// config/read serializes absent TOML fields as null. Sending those values back
// as config overrides turns them into invalid TOML strings on some CLI versions.
function omitAbsentConfig(value: RecordValue): RecordValue {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([key, v]) => [
        key,
        typeof v === "object" && !Array.isArray(v) ? omitAbsentConfig(v) : v,
      ]),
  );
}

async function acquireRuntime(allowAllTools = false): Promise<{
  rpc: JsonLineProcess;
  env: NodeJS.ProcessEnv;
  release: () => void;
}> {
  const env = providerEnvironment("codex", await loadEnvironment());
  const binary = resolveBinary("codex", env);
  if (!binary)
    throw new Error(
      "Codex CLI not found. Open Cli Agent Settings → Codex → CLI Path.",
    );
  // Permission policies must never share a server or its resumed thread state.
  const key = `${runtimeFingerprint("codex", binary, env)}:${allowAllTools}`;
  let entry = runtimes.get(key);
  if (!entry || entry.process.isClosed) {
    const rpc = new JsonLineProcess(
      binary,
      ["app-server", "--listen", "stdio://"],
      supportDirectory("workspace"),
      env,
      "codex",
    );
    // Restricted runs leave mutation approval to the UI. Full tool access
    // authorizes native commands and file changes within this runtime only.
    rpc.onRecord((record) => {
      if (record.id === undefined || !record.method) return;
      let result: RecordValue | undefined;
      if (record.method === "item/permissions/requestApproval")
        result = {
          permissions: allowAllTools
            ? omitAbsentConfig(record.params?.permissions ?? {})
            : {},
          scope: "turn",
        };
      else if (record.method.endsWith("requestApproval"))
        result = { decision: allowAllTools ? "accept" : "decline" };
      else if (record.method === "item/tool/requestUserInput")
        result = { answers: {} };
      rpc.send(
        result
          ? { id: record.id, result }
          : {
              id: record.id,
              error: {
                code: -32601,
                message: "This client does not support that interaction.",
              },
            },
      );
    });
    const ready = rpc
      .request("initialize", {
        clientInfo: {
          name: "raycast-cli-agent",
          title: "Cli Agent",
          version: "1.0.0",
        },
        capabilities: { experimentalApi: true },
      })
      .then(() => {
        rpc.send({ method: "initialized" });
      });
    entry = { process: rpc, ready, users: 0 };
    runtimes.set(key, entry);
    const owned = entry;
    rpc.onClose(() => {
      if (runtimes.get(key) === owned) runtimes.delete(key);
    });
    void ready.catch(() => {
      rpc.shutdown();
    });
  }
  const owned = entry;
  clearTimeout(owned.timer);
  owned.users++;
  const release = () => {
    owned.users--;
    if (owned.users === 0) {
      owned.timer = setTimeout(() => {
        if (runtimes.get(key) === owned) runtimes.delete(key);
        owned.process.shutdown();
      }, 1500);
      owned.timer.unref();
    }
  };
  try {
    await owned.ready;
  } catch (error) {
    release();
    throw error;
  }
  return { rpc: owned.process, env, release };
}

export function shutdownCodexRuntimes(): void {
  for (const entry of runtimes.values()) {
    clearTimeout(entry.timer);
    entry.process.shutdown();
  }
  runtimes.clear();
}

export async function runCodex(opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const messages = new Map<string, string>();
  const steps = new Map<string, string>();
  const commands: string[] = [];
  let text = "";
  let failure: unknown;
  let lease: Awaited<ReturnType<typeof acquireRuntime>> | undefined;
  let unsubscribe = () => {};
  let removeClose = () => {};
  let threadId: string | undefined;
  let turnId: string | undefined;
  let cancelTimer: NodeJS.Timeout | undefined;
  let interrupted = false;
  let complete: () => void = () => {};
  const terminal = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const publish = () => {
    text = [...messages.values()].filter(Boolean).join("\n\n");
    opts.onText?.(usesReviewedCommands(opts) ? splitCommands(text).text : text);
  };
  const interrupt = () => {
    if (interrupted || !threadId || !turnId || !lease) return;
    interrupted = true;
    void lease.rpc
      .request("turn/interrupt", { threadId, turnId }, 5000)
      .catch(() => {});
    cancelTimer = setTimeout(() => {
      failure = new Error("Stopped.");
      complete();
    }, 5000);
  };
  const onAbort = () => interrupt();
  try {
    opts.signal?.throwIfAborted();
    lease = await acquireRuntime(opts.allowAllTools);
    const { rpc, env } = lease;
    const cwd = opts.readDirs?.[0] || supportDirectory("workspace");
    const { config } = await rpc.request("config/read", {
      includeLayers: false,
      cwd,
    });
    const model = codexModelId(opts.model ?? CODEX_DEFAULT) || config.model;
    const configDir = configDirectory("codex", env);
    const native = loadNativeSession(opts.sessionId, "codex", configDir);
    const providerSettings = getProviderSettings("codex");
    const allowAllTools = Boolean(opts.allowAllTools);
    const readable = Boolean(allowAllTools || opts.tools);
    const overrides: RecordValue = {
      web_search: opts.webSearch ? "live" : "disabled",
      "features.shell_tool": readable,
      "features.unified_exec": readable,
      "features.apply_patch": allowAllTools,
      "features.multi_agent": allowAllTools,
      "features.apps": allowAllTools,
      "features.plugins": allowAllTools,
    };
    if (providerSettings.responseVerbosity !== "default")
      overrides.model_verbosity = providerSettings.responseVerbosity;
    if (!allowAllTools && config.mcp_servers) {
      // Config RPC overrides use structured values, not TOML-quoted path keys.
      // Keep transport fields so replacing the table remains valid.
      overrides.mcp_servers = Object.fromEntries(
        Object.entries(config.mcp_servers).map(([name, server]) => [
          name,
          { ...omitAbsentConfig(server as RecordValue), enabled: false },
        ]),
      );
    }
    opts.signal?.throwIfAborted();
    const settings = {
      ...(model ? { model } : {}),
      ...(config.model_provider
        ? { modelProvider: config.model_provider }
        : {}),
      cwd,
      sandbox: allowAllTools ? "danger-full-access" : "read-only",
      approvalPolicy: allowAllTools ? "never" : "on-request",
      approvalsReviewer: "user",
      developerInstructions: instructions(opts),
      config: overrides,
      experimentalRawEvents: true,
    };
    const binding = await rpc.request(
      native ? "thread/resume" : "thread/start",
      native
        ? { threadId: native.id, ...settings, excludeTurns: true }
        : { ...settings, ephemeral: !opts.sessionId },
    );
    threadId = binding.thread.id;
    if (native && threadId !== native.id)
      throw new Error("Codex resumed a different thread. No prompt was sent.");
    saveNativeSession(opts.sessionId, "codex", {
      id: threadId!,
      file: binding.thread.path ?? undefined,
      configDir,
    });
    unsubscribe = rpc.onRecord((record) => {
      const p = record.params;
      if (
        !p ||
        p.threadId !== threadId ||
        (p.turnId && turnId && p.turnId !== turnId)
      )
        return;
      if (record.method === "turn/started") {
        turnId = p.turn.id;
        if (opts.signal?.aborted) interrupt();
      } else if (record.method === "item/agentMessage/delta") {
        messages.set(p.itemId, (messages.get(p.itemId) ?? "") + p.delta);
        publish();
      } else if (
        record.method === "item/started" ||
        record.method === "item/completed"
      ) {
        const item = p.item;
        if (
          item?.type === "agentMessage" &&
          record.method === "item/completed"
        ) {
          messages.set(item.id, item.text);
          publish();
        }
        if (item?.type === "commandExecution")
          steps.set(item.id, codexCommandStep(item.command));
        if (item?.type === "webSearch") steps.set(item.id, codexWebStep(item));
        if (steps.size) opts.onSteps?.([...steps.values()]);
      } else if (
        record.method === "item/commandExecution/requestApproval" &&
        usesReviewedCommands(opts) &&
        p.command
      ) {
        commands.push(p.command);
      } else if (record.method === "turn/completed") {
        if (turnId && p.turn.id !== turnId) return;
        for (const item of p.turn.items ?? [])
          if (item.type === "agentMessage") messages.set(item.id, item.text);
        publish();
        if (p.turn.status === "failed" || p.turn.status === "interrupted")
          failure = new Error(p.turn.error?.message || p.turn.status);
        complete();
      } else if (record.method === "error" && !p.willRetry) {
        failure = new Error(p.error?.message || "Codex request failed.");
        complete();
      }
    });
    removeClose = rpc.onClose((error) => {
      failure = error;
      complete();
    });
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    opts.signal?.throwIfAborted();
    const turn = await rpc.request("turn/start", {
      ...(providerSettings.reasoningSummary !== "default"
        ? { summary: providerSettings.reasoningSummary }
        : {}),
      threadId,
      input: [{ type: "text", text: opts.prompt, text_elements: [] }],
      ...(model ? { model } : {}),
      ...(opts.effort ||
      providerSettings.effort ||
      config.model_reasoning_effort
        ? {
            effort:
              opts.effort ||
              providerSettings.effort ||
              config.model_reasoning_effort,
          }
        : {}),
    });
    turnId ??= turn.turn.id;
    if (opts.signal?.aborted) interrupt();
    await terminal;
    if (opts.signal?.aborted) failure = new Error("Stopped.");
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(cancelTimer);
    opts.signal?.removeEventListener("abort", onAbort);
    unsubscribe();
    removeClose();
    if (lease && threadId && !lease.rpc.isClosed) {
      await lease.rpc
        .request("thread/unsubscribe", { threadId }, 3000)
        .catch(() => {});
    }
    lease?.release();
  }
  const result = finishResult(
    "codex",
    opts,
    text,
    started,
    [...steps.values()],
    failure,
    commands,
  );
  if (result.error?.message.startsWith("Codex CLI not found"))
    result.error.kind = "not-installed";
  return result;
}

export interface CodexModel {
  value: string;
  title: string;
  description?: string;
  resolvedModel?: string;
}

export async function fetchCodexModels(): Promise<CodexModel[]> {
  const lease = await acquireRuntime();
  try {
    const { config } = await lease.rpc.request("config/read", {
      includeLayers: false,
    });
    const models: CodexModel[] = [
      {
        value: CODEX_DEFAULT,
        title: "Codex",
        resolvedModel: config.model
          ? `${CODEX_PREFIX}${config.model}`
          : undefined,
        description: config.model
          ? `Configured model: ${config.model}`
          : undefined,
      },
    ];
    if (config.model)
      models.push({
        value: `${CODEX_PREFIX}${config.model}`,
        title: config.model,
        description: `Provider: ${config.model_provider || "default"}`,
      });
    let cursor: string | undefined;
    let pages = 0;
    const seen = new Set<string>();
    // Third-party providers may not expose a catalog. Their configured model still works.
    try {
      do {
        const page = await lease.rpc.request(
          "model/list",
          { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) },
          15_000,
        );
        if (!Array.isArray(page.data))
          throw new Error("Codex returned an invalid model catalog.");
        pages++;
        for (const model of page.data) {
          const id = model.model || model.id;
          if (id && model.isDefault && !models[0].resolvedModel)
            models[0].resolvedModel = `${CODEX_PREFIX}${id}`;
          if (id && !models.some((m) => m.value === `${CODEX_PREFIX}${id}`))
            models.push({
              value: `${CODEX_PREFIX}${id}`,
              title: model.displayName || id,
              description: model.description,
            });
        }
        cursor = page.nextCursor || undefined;
        if (cursor && seen.has(cursor))
          throw new Error("Repeated model catalog cursor.");
        if (cursor) seen.add(cursor);
      } while (cursor);
    } catch (error) {
      // Only an explicitly unsupported catalog on a configured third-party
      // backend can fall back. Timeouts, auth failures and partial pages fail
      // discovery so the caller preserves the last complete catalog.
      if (!(
        pages === 0 &&
        config.model &&
        config.model_provider &&
        config.model_provider !== "openai" &&
        error instanceof RpcError &&
        error.code === -32601
      ))
        throw error;
    }
    if (models.length === 1)
      throw new Error("Codex did not report any usable models.");
    return models;
  } finally {
    lease.release();
  }
}
