import { basename, dirname } from "node:path";
import type { ModelOption } from "./models";
import {
  ANTIGRAVITY_DEFAULT,
  ANTIGRAVITY_PREFIX,
  antigravityModelId,
} from "./provider";
import { ANTIGRAVITY_EFFORTS, getProviderSettings } from "./settings";
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
import { loadNativeSession, saveNativeSession } from "./backend/sessions";
import { antigravityToolStep } from "./steps";

export interface AntigravityReasoningEffort {
  label: string;
  value: string;
}

export interface AntigravityModel {
  displayName: string;
  rawId: string;
  reasoningEfforts: AntigravityReasoningEffort[];
}

const DEFAULT_LEVEL_ORDER = ["low", "medium", "high", "xhigh", "max"];
const EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
};

function formatEffortLabel(value: string): string {
  return (
    EFFORT_LABELS[value] ??
    (value ? value[0].toUpperCase() + value.slice(1) : value)
  );
}

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findSelectOption(
  configOptions: readonly RecordValue[] | null | undefined,
  configId: string,
): RecordValue | null {
  const option = configOptions?.find((entry) => entry?.id === configId);
  return option?.type === "select" ? option : null;
}

function flattenSelectOptions(
  options: readonly RecordValue[] | undefined,
): RecordValue[] {
  return (options ?? []).flatMap((option) =>
    Array.isArray(option?.options) ? option.options : [option],
  );
}

function groupLevelsByModel(
  baseIds: readonly string[],
  variants: readonly RecordValue[],
  sessionLevels: readonly AntigravityReasoningEffort[],
): Map<string, AntigravityReasoningEffort[]> {
  const byLength = [...baseIds].sort((a, b) => b.length - a.length);
  const levels = new Map<string, Set<string>>(
    baseIds.map((id) => [id, new Set<string>()]),
  );
  for (const variant of variants) {
    const modelId = variant?.modelId ?? variant?.id;
    if (typeof modelId !== "string") continue;
    const base = byLength.find(
      (id) => modelId === id || modelId.startsWith(`${id}-`),
    );
    if (base && modelId !== base)
      levels.get(base)!.add(modelId.slice(base.length + 1));
  }
  const order = [...sessionLevels.map((l) => l.value), ...DEFAULT_LEVEL_ORDER];
  const rank = (value: string) => {
    const index = order.indexOf(value);
    return index < 0 ? order.length : index;
  };
  return new Map(
    [...levels].map(([id, values]) => [
      id,
      [...values]
        .sort((a, b) => rank(a) - rank(b))
        .map(
          (value) =>
            sessionLevels.find((l) => l.value === value) ?? {
              label: formatEffortLabel(value),
              value,
            },
        ),
    ]),
  );
}

export function readAntigravityThinkingLevels(
  configOptions: readonly RecordValue[] | null | undefined,
): AntigravityReasoningEffort[] {
  return flattenSelectOptions(
    findSelectOption(configOptions, "thought_level")?.options,
  )
    .filter(
      (option) =>
        typeof option?.value === "string" && option.value.trim().length > 0,
    )
    .map((option) => ({
      label:
        (typeof option.name === "string" && option.name.trim()) ||
        formatEffortLabel(option.value),
      value: option.value.trim(),
    }));
}

export function readAntigravityConfigValue(
  configOptions: readonly RecordValue[] | null | undefined,
  configId: string,
): string | null {
  const value = findSelectOption(configOptions, configId)?.currentValue;
  return typeof value === "string" ? value : null;
}

export function readAntigravitySessionModels(
  configOptions: readonly RecordValue[] | null | undefined,
  sessionModels?: RecordValue | null,
): { currentModelId: string | null; models: AntigravityModel[] } {
  const modelOption = findSelectOption(configOptions, "model");
  const sessionLevels = readAntigravityThinkingLevels(configOptions);
  if (modelOption) {
    const options = flattenSelectOptions(modelOption.options).filter(
      (o) => typeof o?.value === "string" && o.value.trim().length > 0,
    );
    const currentModelId =
      typeof modelOption.currentValue === "string" && modelOption.currentValue
        ? modelOption.currentValue
        : null;
    const baseIds = options.map((o) => o.value.trim());
    const levelsByModel = sessionModels
      ? groupLevelsByModel(
          baseIds,
          Array.isArray(sessionModels.availableModels)
            ? sessionModels.availableModels
            : [],
          sessionLevels,
        )
      : null;
    return {
      currentModelId,
      models: options.map((o) => {
        const rawId = o.value.trim();
        return {
          rawId,
          displayName: (typeof o.name === "string" && o.name.trim()) || rawId,
          reasoningEfforts:
            levelsByModel?.get(rawId) ??
            (rawId === currentModelId ? sessionLevels : []),
        };
      }),
    };
  }
  const available = Array.isArray(sessionModels?.availableModels)
    ? sessionModels.availableModels
    : [];
  const models: AntigravityModel[] = [];
  const seen = new Set<string>();
  for (const entry of available) {
    const rawId = String(entry?.modelId ?? entry?.id ?? "").trim();
    if (!rawId || seen.has(rawId)) continue;
    seen.add(rawId);
    models.push({
      rawId,
      displayName:
        (typeof entry?.name === "string" && entry.name.trim()) || rawId,
      reasoningEfforts: [],
    });
  }
  const currentModelId =
    typeof sessionModels?.currentModelId === "string" &&
    sessionModels.currentModelId.trim()
      ? sessionModels.currentModelId.trim()
      : null;
  return { currentModelId, models };
}

export function readAntigravityModelList(output: string): AntigravityModel[] {
  const rows = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = /^(\S+)\t+(.+)$/.exec(line.trim());
    if (match) rows.set(match[1], match[2].trim());
  }
  const candidates = new Map<string, { id: string; name: string }>();
  const counts = new Map<string, number>();
  for (const [id, name] of rows) {
    const match = /^(.+) \((low|medium|high|xhigh|max)\)$/i.exec(name);
    if (!match || !id.endsWith(`-${match[2].toLowerCase()}`)) continue;
    const base = id.slice(0, -(match[2].length + 1));
    candidates.set(id, { id: base, name: match[1] });
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const models = new Map<string, string>();
  for (const [id, name] of rows) {
    const base = candidates.get(id);
    if (base && (counts.get(base.id)! > 1 || rows.has(base.id)))
      models.set(base.id, rows.get(base.id) ?? base.name);
    else models.set(id, name);
  }
  const levels = groupLevelsByModel(
    [...models.keys()],
    [...rows.keys()].map((modelId) => ({ modelId })),
    [],
  );
  return [...models].map(([rawId, displayName]) => ({
    rawId,
    displayName,
    reasoningEfforts: levels.get(rawId)!,
  }));
}

export function resolveAntigravityBinary(): string | undefined {
  return resolveBinary("antigravity");
}

function allowPermission(options: unknown): RecordValue {
  const list = Array.isArray(options) ? options : [];
  const option =
    list.find((entry) => entry?.kind === "allow_once") ??
    list.find((entry) => entry?.kind === "allow_always");
  return option?.optionId
    ? { outcome: { outcome: "selected", optionId: option.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

const DENY_PERMISSION = { outcome: { outcome: "cancelled" } };

async function launchAntigravity(
  opts?: RunOptions,
  onCommand?: (command: string) => void,
) {
  const env = providerEnvironment("antigravity", await loadEnvironment());
  opts?.signal?.throwIfAborted();
  const binary = resolveBinary("antigravity", env);
  if (!binary)
    throw new Error(
      "Antigravity CLI not found. Open Cli Agent Settings → Antigravity → CLI Path.",
    );
  const settings = getProviderSettings("antigravity");
  const configDir = configDirectory("antigravity", env, settings);
  const args = ["acp"];
  if (settings.configDir.trim()) {
    args.push(
      "--gemini-dir",
      dirname(configDir),
      "--app-data-dir",
      basename(configDir),
    );
  }
  if (opts?.allowAllTools) {
    args.push("--dangerously-skip-permissions");
  } else {
    args.push("--sandbox", "--include-default-customizations=false");
  }
  if (opts && (opts.allowAllTools || opts.tools)) {
    for (const dir of opts.readDirs ?? []) args.push("--add-dir", dir);
  }

  const rpc = new JsonLineProcess(
    binary,
    args,
    supportDirectory("workspace"),
    env,
    "antigravity",
  );
  const removeServerRequests = rpc.onRecord((record) => {
    if (record.id === undefined || typeof record.method !== "string") return;
    if (record.method === "elicitation/create") {
      rpc.send({
        jsonrpc: "2.0",
        id: record.id,
        result: { action: "cancel" },
      });
      return;
    }
    if (record.method === "session/request_permission") {
      const toolCall = record.params?.toolCall;
      const toolName = String(toolCall?.name || toolCall?.title || "").trim();
      const options = record.params?.options;
      let result: RecordValue = DENY_PERMISSION;
      if (!opts) {
        result = DENY_PERMISSION;
      } else if (opts.allowAllTools) {
        result =
          toolName === "search_web" && !opts.webSearch
            ? DENY_PERMISSION
            : allowPermission(options);
      } else if (opts.tools) {
        if (toolName === "read_file") {
          result = allowPermission(options);
        } else if (toolName === "search_web" && opts.webSearch) {
          result = allowPermission(options);
        } else {
          if (toolName === "run_command" && isRecord(toolCall?.rawInput)) {
            const cmd =
              toolCall.rawInput.CommandLine ?? toolCall.rawInput.command;
            if (typeof cmd === "string" && cmd.trim()) onCommand?.(cmd.trim());
          }
          result = DENY_PERMISSION;
        }
      } else {
        result =
          toolName === "search_web" && opts.webSearch
            ? allowPermission(options)
            : DENY_PERMISSION;
      }
      rpc.send({ jsonrpc: "2.0", id: record.id, result });
      return;
    }
    rpc.send({
      jsonrpc: "2.0",
      id: record.id,
      error: { code: -32601, message: "Unsupported client request." },
    });
  });

  const close = () => {
    removeServerRequests();
    rpc.shutdown();
  };

  try {
    opts?.signal?.throwIfAborted();
    await rpc.request(
      "initialize",
      {
        protocolVersion: 1,
        clientInfo: {
          name: "raycast-cli-agent",
          title: "Cli Agent",
          version: "1.0.0",
        },
      },
      20_000,
    );
    return { rpc, configDir, env, close };
  } catch (error) {
    close();
    throw error;
  }
}

export async function fetchAntigravityModels(): Promise<ModelOption[]> {
  const { rpc, close } = await launchAntigravity();
  let sessionId: string | undefined;
  try {
    const session = await rpc.request(
      "session/new",
      { cwd: supportDirectory("workspace"), mcpServers: [] },
      20_000,
    );
    sessionId =
      typeof session.sessionId === "string" ? session.sessionId : undefined;
    const { currentModelId, models } = readAntigravitySessionModels(
      session.configOptions,
      session.models,
    );
    if (models.length === 0)
      throw new Error(
        "Antigravity did not report any available models. Run `agy acp --login` or update the CLI and refresh models.",
      );
    const list: ModelOption[] = models.map((m) => ({
      value: `${ANTIGRAVITY_PREFIX}${m.rawId}`,
      title: m.displayName,
      description: m.reasoningEfforts.length
        ? `Effort: ${m.reasoningEfforts.map((e) => e.label).join(", ")}`
        : undefined,
    }));
    if (currentModelId) {
      const resolved = `${ANTIGRAVITY_PREFIX}${currentModelId}`;
      if (!list.some((m) => m.value === resolved))
        list.push({ value: resolved, title: currentModelId });
      list.unshift({
        value: ANTIGRAVITY_DEFAULT,
        title: "Antigravity",
        resolvedModel: resolved,
      });
    }
    return list;
  } finally {
    if (sessionId && !rpc.isClosed) {
      await rpc.request("session/close", { sessionId }, 1500).catch(() => {});
    }
    close();
  }
}

export async function runAntigravity(opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const segments = new Map<string, string>();
  const steps = new Map<string, string>();
  const commands: string[] = [];
  let anonSegment = 0;
  let activeAnonKey = "seg-0";
  let text = "";
  let failure: unknown;
  let rpc: JsonLineProcess | undefined;
  let close = () => {};
  let sessionId: string | undefined;
  let removeNotification = () => {};
  let removeClose = () => {};
  let cancelTimer: NodeJS.Timeout | undefined;
  let aborted = false;

  const publish = () => {
    text = [...segments.values()].filter(Boolean).join("\n\n");
    opts.onText?.(usesReviewedCommands(opts) ? splitCommands(text).text : text);
  };

  let abortReject: (error: Error) => void = () => {};
  const onAbort = () => {
    if (aborted) return;
    aborted = true;
    if (rpc && !rpc.isClosed && sessionId) {
      rpc.send({
        jsonrpc: "2.0",
        method: "session/cancel",
        params: { sessionId },
      });
    }
    cancelTimer = setTimeout(() => {
      abortReject(new Error("Stopped."));
      rpc?.shutdown();
    }, 2000);
  };

  try {
    opts.signal?.throwIfAborted();
    const launch = await launchAntigravity(opts, (cmd) => {
      if (!commands.includes(cmd)) commands.push(cmd);
    });
    rpc = launch.rpc;
    close = launch.close;
    const { configDir } = launch;
    const native = loadNativeSession(opts.sessionId, "antigravity", configDir);

    let systemPromptAppend = instructions(opts);
    if (!opts.allowAllTools && !opts.tools) {
      systemPromptAppend += `\n\n${
        opts.webSearch
          ? "Do not use any local file, shell, or MCP tools for this request. Only web search (search_web) may be used when needed."
          : "Do not use any tools for this request. Answer only from information supplied directly in the prompt."
      }`;
    } else if (!opts.webSearch) {
      systemPromptAppend +=
        "\n\nWeb search is disabled for this request. Do not use search_web.";
    }

    const sessionReq: RecordValue = {
      cwd: supportDirectory("workspace"),
      mcpServers: [],
      ...((opts.allowAllTools || opts.tools) && opts.readDirs?.length
        ? { additionalDirectories: opts.readDirs }
        : {}),
    };

    let configOptions: RecordValue[] = [];
    let sessionModels: RecordValue | null | undefined;

    if (!native) {
      const created = await rpc.request("session/new", sessionReq, 20_000);
      if (typeof created.sessionId !== "string" || !created.sessionId.trim())
        throw new Error("Antigravity did not return a session ID.");
      sessionId = created.sessionId;
      saveNativeSession(opts.sessionId, "antigravity", {
        id: sessionId,
        configDir,
      });
      const resumed = await rpc.request(
        "session/resume",
        {
          ...sessionReq,
          sessionId,
          _meta: {
            antigravity: { systemPrompt: { append: systemPromptAppend } },
          },
        },
        20_000,
      );
      if (resumed.sessionId && resumed.sessionId !== sessionId)
        throw new Error(
          "Antigravity resumed a different session. No prompt was sent; the saved binding was preserved.",
        );
      configOptions = resumed.configOptions ?? created.configOptions ?? [];
      sessionModels = resumed.models ?? created.models;
    } else {
      const resumed = await rpc.request(
        "session/resume",
        {
          ...sessionReq,
          sessionId: native.id,
          _meta: {
            antigravity: { systemPrompt: { append: systemPromptAppend } },
          },
        },
        20_000,
      );
      if (resumed.sessionId && resumed.sessionId !== native.id)
        throw new Error(
          "Antigravity resumed a different session. No prompt was sent; the saved binding was preserved.",
        );
      sessionId = native.id;
      saveNativeSession(opts.sessionId, "antigravity", {
        id: sessionId,
        configDir,
      });
      configOptions = resumed.configOptions ?? [];
      sessionModels = resumed.models;
    }

    const effort = opts.effort || getProviderSettings("antigravity").effort;
    if (effort && !ANTIGRAVITY_EFFORTS.includes(effort))
      throw new Error("Invalid Antigravity reasoning effort.");

    const rawModel = antigravityModelId(opts.model ?? ANTIGRAVITY_DEFAULT);
    if (
      rawModel &&
      rawModel !== readAntigravityConfigValue(configOptions, "model")
    ) {
      const { models } = readAntigravitySessionModels(
        configOptions,
        sessionModels,
      );
      const selected = models.find((m) => m.rawId === rawModel);
      const value =
        effort && selected?.reasoningEfforts.some((e) => e.value === effort)
          ? `${rawModel}-${effort}`
          : rawModel;
      const updated = await rpc.request(
        "session/set_config_option",
        { sessionId, configId: "model", value },
        20_000,
      );
      if (Array.isArray(updated.configOptions))
        configOptions = updated.configOptions;
    }

    const availableEfforts = readAntigravityThinkingLevels(configOptions);
    if (effort && availableEfforts.length > 0) {
      if (!availableEfforts.some((e) => e.value === effort))
        throw new Error(
          `Antigravity does not support reasoning effort "${effort}" for this model.`,
        );
      if (
        readAntigravityConfigValue(configOptions, "thought_level") !== effort
      ) {
        const updated = await rpc.request(
          "session/set_config_option",
          { sessionId, configId: "thought_level", value: effort },
          20_000,
        );
        if (Array.isArray(updated.configOptions))
          configOptions = updated.configOptions;
      }
    }

    const currentMode = readAntigravityConfigValue(configOptions, "mode");
    if (currentMode && currentMode !== "default") {
      const updated = await rpc.request(
        "session/set_config_option",
        { sessionId, configId: "mode", value: "default" },
        20_000,
      );
      if (Array.isArray(updated.configOptions))
        configOptions = updated.configOptions;
    }

    removeNotification = rpc.onRecord((record) => {
      if (
        record.method !== "session/update" ||
        record.params?.sessionId !== sessionId
      )
        return;
      const update = record.params?.update;
      if (!isRecord(update)) return;
      if (update.sessionUpdate === "agent_message_chunk") {
        const content = update.content;
        if (
          isRecord(content) &&
          content.type === "text" &&
          typeof content.text === "string"
        ) {
          const key =
            typeof update.messageId === "string" && update.messageId
              ? update.messageId
              : activeAnonKey;
          segments.set(key, (segments.get(key) ?? "") + content.text);
          publish();
        }
      } else if (
        update.sessionUpdate === "tool_call" ||
        update.sessionUpdate === "tool_call_update"
      ) {
        if (segments.get(activeAnonKey)) {
          anonSegment++;
          activeAnonKey = `seg-${anonSegment}`;
        }
        const toolCallId =
          typeof update.toolCallId === "string" && update.toolCallId
            ? update.toolCallId
            : `tool-${steps.size}`;
        const rawName = String(
          update.name || update.title || update.kind || "tool",
        );
        const rawInput = isRecord(update.rawInput) ? update.rawInput : {};
        steps.set(toolCallId, antigravityToolStep(rawName, rawInput));
        opts.onSteps?.([...steps.values()]);
      } else if (
        update.sessionUpdate === "config_option_update" &&
        Array.isArray(update.configOptions)
      ) {
        configOptions = update.configOptions;
      }
    });

    const closedPromise = new Promise<never>((_resolve, reject) => {
      abortReject = reject;
      removeClose = rpc!.onClose(reject);
    });

    opts.signal?.addEventListener("abort", onAbort, { once: true });
    opts.signal?.throwIfAborted();

    const response = await Promise.race([
      rpc.request(
        "session/prompt",
        { sessionId, prompt: [{ type: "text", text: opts.prompt }] },
        0,
      ),
      closedPromise,
    ]);
    if (response?.stopReason === "cancelled" || opts.signal?.aborted) {
      failure = new Error("Stopped.");
    }
  } catch (error) {
    failure = error;
  } finally {
    clearTimeout(cancelTimer);
    opts.signal?.removeEventListener("abort", onAbort);
    removeNotification();
    removeClose();
    if (rpc && sessionId && !rpc.isClosed) {
      await rpc.request("session/close", { sessionId }, 1500).catch(() => {});
    }
    close();
  }

  if (opts.signal?.aborted) failure = new Error("Stopped.");
  const result = finishResult(
    "antigravity",
    opts,
    text,
    started,
    [...steps.values()],
    failure,
    commands,
  );
  if (result.error?.message.startsWith("Antigravity CLI not found"))
    result.error.kind = "not-installed";
  return result;
}
