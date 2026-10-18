import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { getProviderSettings } from "./settings";
import { PI_DEFAULT, PI_PREFIX, piModelId } from "./provider";
import { RunOptions, RunResult } from "./types";
import {
  configDirectory,
  loadEnvironment,
  providerEnvironment,
  resolveBinary,
  supportDirectory,
} from "./backend/environment";
import { JsonLineProcess, RecordValue } from "./backend/rpc";
import {
  finishResult,
  instructions,
  splitCommands,
  usesReviewedCommands,
} from "./backend/result";
import {
  loadNativeSession,
  NativeSession,
  saveNativeSession,
} from "./backend/sessions";
import { piToolStep } from "./steps";

export function resolvePiBinary(): string | undefined {
  return resolveBinary("pi");
}

async function launchPi(opts?: RunOptions): Promise<{
  rpc: JsonLineProcess;
  native?: NativeSession;
  configDir: string;
  binary: string;
  env: NodeJS.ProcessEnv;
}> {
  const env = providerEnvironment("pi", await loadEnvironment());
  const binary = resolveBinary("pi", env);
  if (!binary)
    throw new Error(
      "Pi Agent CLI not found. Open Cli Agent Settings → Pi Agent → CLI Path.",
    );
  const configDir = configDirectory("pi", env);
  const native = loadNativeSession(opts?.sessionId, "pi", configDir);
  const args = ["--mode", "rpc"];
  if (!opts?.allowAllTools)
    args.push(
      "--no-extensions",
      "--no-mcp",
      "--no-skills",
      "--no-prompt-templates",
      "--no-context-files",
    );
  if (opts) {
    args.push("--system-prompt", instructions(opts));
    const model = piModelId(opts.model ?? PI_DEFAULT);
    if (model)
      args.push("--provider", model.provider, "--model", model.modelId);
    const thinking = opts.effort || getProviderSettings("pi").thinkingLevel;
    if (thinking) args.push("--thinking", thinking);
  }
  if (opts?.allowAllTools) args.push("--tools", "*");
  else if (opts?.tools || opts?.readDirs?.length)
    args.push("--tools", "read,grep,find,ls");
  else args.push("--no-tools");
  if (!opts?.sessionId) args.push("--no-session");
  else {
    args.push("--session-dir", supportDirectory("sessions", "pi"));
    if (native) args.push("--session", native.file || native.id);
  }
  const rpc = new JsonLineProcess(
    binary,
    args,
    opts?.readDirs?.[0] || supportDirectory("workspace"),
    env,
    "pi",
  );
  // Metadata probes and unattended runs must not hang on extension dialogs.
  rpc.onRecord((event) => {
    if (event.type === "extension_ui_request" && event.id)
      rpc.send({
        type: "extension_ui_response",
        id: event.id,
        cancelled: true,
      });
  });
  return { rpc, native, configDir, binary, env };
}

export function verifyPiSession(
  state: RecordValue,
  native?: NativeSession,
): void {
  if (!native) return;
  if (
    state.sessionId !== native.id ||
    (native.file &&
      (!state.sessionFile ||
        resolve(state.sessionFile) !== resolve(native.file)))
  ) {
    throw new Error(
      "Pi resumed a different session. No prompt was sent; the saved session binding was preserved.",
    );
  }
}

function saveState(
  opts: RunOptions,
  state: RecordValue,
  configDir: string,
): void {
  if (typeof state.sessionId !== "string" || !state.sessionId) {
    if (opts.sessionId)
      throw new Error("Pi did not report a native session ID.");
    return;
  }
  saveNativeSession(opts.sessionId, "pi", {
    id: state.sessionId,
    file: state.sessionFile || undefined,
    configDir,
  });
}

export async function runPi(opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  let rpc: JsonLineProcess | undefined;
  let text = "";
  const messages: string[] = [];
  let current = -1;
  const steps: string[] = [];
  let failure: unknown;
  let removeEvent = () => {};
  let removeClose = () => {};
  let cancelTimer: NodeJS.Timeout | undefined;
  let complete: () => void = () => {};
  const terminal = new Promise<void>((resolve) => {
    complete = resolve;
  });
  let settlement: "unknown" | "agent_end" | "agent_settled" = "unknown";
  let endedWithoutRetry = false;
  let settled = false;
  let runStarted = false;
  const publish = () => {
    text = messages.filter(Boolean).join("\n\n");
    opts.onText?.(usesReviewedCommands(opts) ? splitCommands(text).text : text);
  };
  const onAbort = () => {
    if (rpc && !rpc.isClosed)
      void rpc.request("abort", {}, 3000).catch(() => {});
    cancelTimer = setTimeout(() => {
      failure = new Error("Stopped.");
      complete();
      rpc?.shutdown();
    }, 3000);
  };
  try {
    opts.signal?.throwIfAborted();
    if (opts.webSearch && !opts.allowAllTools)
      throw new Error(
        "Pi has no built-in web search in this extension. Disable Web Search or select Codex.",
      );
    const launch = await launchPi(opts);
    rpc = launch.rpc;
    const initial = await rpc.request("get_state", {}, 15_000);
    verifyPiSession(initial, launch.native);
    saveState(opts, initial, launch.configDir);
    if (!opts.effort) {
      const modelId =
        initial.model?.provider && initial.model?.id
          ? `${PI_PREFIX}${initial.model.provider}/${initial.model.id}`
          : opts.model;
      const thinking =
        modelId && getProviderSettings("pi").preferredThinkingByModel[modelId];
      if (thinking)
        await rpc.request("set_thinking_level", { level: thinking });
    }
    removeEvent = rpc.onRecord((event) => {
      if (event.type === "agent_start") runStarted = true;
      if (
        event.type === "message_start" &&
        event.message?.role === "assistant"
      ) {
        current = messages.push("") - 1;
        failure = undefined;
      } else if (event.type === "message_update") {
        const delta =
          event.assistantMessageEvent ?? event.assistant_message_event ?? event;
        const value =
          delta.text_delta ??
          delta.textDelta ??
          (delta.type === "text_delta" ? delta.delta : undefined);
        if (typeof value === "string") {
          if (current < 0) current = messages.push("") - 1;
          messages[current] += value;
          publish();
        }
      } else if (
        event.type === "message_end" &&
        event.message?.role === "assistant"
      ) {
        const message = event.message;
        if (current < 0) current = messages.push("") - 1;
        if (Array.isArray(message.content))
          messages[current] = message.content
            .filter((c: RecordValue) => c.type === "text")
            .map((c: RecordValue) => c.text)
            .join("");
        if (message.stopReason === "error" || message.stop_reason === "error")
          failure = new Error(
            message.errorMessage ||
              message.error_message ||
              "Pi request failed.",
          );
        publish();
      } else if (event.type === "tool_execution_start") {
        steps.push(
          piToolStep(
            event.toolName || event.name,
            event.args || event.input || {},
          ),
        );
        opts.onSteps?.([...steps]);
      } else if (event.type === "agent_end") {
        endedWithoutRetry = !event.willRetry;
        if (endedWithoutRetry && settlement === "agent_end") complete();
      } else if (event.type === "agent_settled") {
        settled = true;
        settlement = "agent_settled";
        complete();
      }
    });
    removeClose = rpc.onClose((error) => {
      failure = error;
      complete();
    });
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    opts.signal?.throwIfAborted();
    const response = await rpc.request("prompt", {
      message: opts.prompt,
      streamingBehavior: "followUp",
    });
    if (typeof response.disposition !== "string" && !settled) {
      settlement = "agent_end";
      if (endedWithoutRetry) complete();
    } else settlement = "agent_settled";
    if (response.disposition !== "handled" || runStarted) await terminal;
    if (opts.signal?.aborted) failure = new Error("Stopped.");
    else if (!rpc.isClosed) {
      const final = await rpc.request("get_state");
      verifyPiSession(final, {
        id: initial.sessionId,
        file: initial.sessionFile,
        configDir: launch.configDir,
      });
      saveState(opts, final, launch.configDir);
    }
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(cancelTimer);
    opts.signal?.removeEventListener("abort", onAbort);
    removeEvent();
    removeClose();
    rpc?.shutdown();
  }
  const result = finishResult("pi", opts, text, started, steps, failure);
  if (result.error?.message.startsWith("Pi Agent CLI not found"))
    result.error.kind = "not-installed";
  return result;
}

function checkPiAuth(
  binary: string,
  env: NodeJS.ProcessEnv,
  provider: string,
): Promise<boolean> {
  return new Promise((resolveAuth, reject) => {
    execFile(
      binary,
      ["auth", "check", "--provider", provider, "--json", "--no-refresh"],
      {
        env,
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      },
      (error, stdout) => {
        try {
          const result = JSON.parse(stdout);
          if (result.provider !== provider) throw new Error();
          if (result.status === "ready" && !error) return resolveAuth(true);
          if (result.status === "not_ready") return resolveAuth(false);
        } catch {
          /* Do not expose CLI output, which can contain credentials. */
        }
        reject(
          new Error(
            `Pi could not check authentication for ${provider}${error?.killed ? " (timed out)" : ""}. A CLI supporting 'pi auth check --json --no-refresh' is required.`,
          ),
        );
      },
    );
  });
}

export async function fetchPiModels(): Promise<
  {
    value: string;
    title: string;
    description?: string;
    resolvedModel?: string;
  }[]
> {
  const { rpc, binary, env } = await launchPi();
  try {
    const state = await rpc.request("get_state", {}, 20_000);
    const response = await rpc.request("get_available_models", {}, 20_000);
    const activeModel =
      state.model?.provider && state.model?.id
        ? `${PI_PREFIX}${state.model.provider}/${state.model.id}`
        : undefined;
    const candidates: RecordValue[] = (
      Array.isArray(response) ? response : (response.models ?? [])
    ).filter(
      (m: RecordValue) =>
        typeof m.provider === "string" && typeof m.id === "string",
    );
    // Pi's auth command is authoritative in the same launch environment.
    // Never infer authentication from model metadata or inspect credential values.
    const providers = [...new Set(candidates.map((m) => m.provider as string))];
    const ready = new Set<string>();
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, providers.length) }, async () => {
        while (next < providers.length) {
          const provider = providers[next++];
          if (await checkPiAuth(binary, env, provider)) ready.add(provider);
        }
      }),
    );
    const models: {
      value: string;
      title: string;
      description?: string;
      resolvedModel?: string;
    }[] = candidates
      .filter((m) => ready.has(m.provider))
      .map((m: RecordValue) => ({
        value: `${PI_PREFIX}${m.provider}/${m.id}`,
        title: `${m.name || m.id} (${m.provider})`,
        description: m.reasoning ? "Supports reasoning" : undefined,
      }));
    // An old current model must not bypass auth or the discovered catalog.
    if (activeModel && models.some((m) => m.value === activeModel))
      models.unshift({
        value: PI_DEFAULT,
        title: "Pi Agent",
        resolvedModel: activeModel,
      });
    return models;
  } finally {
    rpc.shutdown();
  }
}
