import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CLAUDE_DEFAULT, CLAUDE_PREFIX } from "./provider";
import { CLAUDE_EFFORTS, getProviderSettings } from "./settings";
import { RunOptions, RunResult } from "./types";
import type { ModelOption } from "./models";
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
import { claudeToolStep } from "./steps";

export function resolveClaudeBinary(): string | undefined {
  return resolveBinary("claude");
}

function userMessage(content: string): RecordValue {
  return {
    type: "user",
    message: { role: "user", content },
    parent_tool_use_id: null,
    session_id: "",
  };
}

// Control initialization returns models without user input or inference.
// Empty user messages can trigger inference in current Claude Code versions.
async function launchClaude(opts?: RunOptions) {
  const env = providerEnvironment("claude", await loadEnvironment());
  opts?.signal?.throwIfAborted();
  const binary = resolveBinary("claude", env);
  if (!binary)
    throw new Error(
      "Claude Code CLI not found. Open Cli Agent Settings → Claude Code → CLI Path.",
    );
  const configDir = configDirectory("claude", env);
  const native = loadNativeSession(opts?.sessionId, "claude", configDir);
  const sessionId = native?.id ?? randomUUID();
  const allowAllTools = Boolean(opts?.allowAllTools);
  const tools = [
    ...(opts?.tools || opts?.readDirs?.length ? ["Read", "Glob", "Grep"] : []),
    ...(opts?.webSearch ? ["WebSearch", "WebFetch"] : []),
  ];
  const args = [
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--permission-prompt-tool",
    "stdio",
    "--permission-mode",
    allowAllTools ? "bypassPermissions" : "default",
    "--setting-sources",
    "user",
  ];
  if (allowAllTools) args.push("--tools", "default");
  else {
    args.push(
      "--settings",
      JSON.stringify({ disableAllHooks: true }),
      "--disable-slash-commands",
      "--strict-mcp-config",
      "--mcp-config",
      JSON.stringify({ mcpServers: {} }),
      "--disallowedTools",
      "Bash,Edit,Write,NotebookEdit,Agent,Task,mcp__*",
      "--tools",
      tools.join(","),
    );
    if (tools.length) args.push("--allowedTools", tools.join(","));
  }
  if (!opts?.sessionId) args.push("--no-session-persistence");
  args.push(native ? `--resume=${sessionId}` : `--session-id=${sessionId}`);
  if (opts) {
    // Re-render the prompt when tool access changes in an existing session.
    args.push(
      "--system-prompt-snapshot",
      "off",
      "--system-prompt",
      instructions(opts),
    );
    if (opts.model && opts.model !== CLAUDE_DEFAULT)
      args.push("--model", opts.model.slice(CLAUDE_PREFIX.length));
    const effort = opts.effort || getProviderSettings("claude").effort;
    if (effort) {
      if (!CLAUDE_EFFORTS.includes(effort))
        throw new Error("Invalid Claude reasoning effort.");
      args.push("--effort", effort);
    }
    for (const dir of opts.readDirs ?? []) args.push("--add-dir", dir);
  }
  // A stable cwd keeps native history resumable even when Finder paths change.
  const rpc = new JsonLineProcess(
    binary,
    args,
    supportDirectory("workspace"),
    env,
    "claude",
  );
  const removeControl = rpc.onRecord((record) => {
    if (record.type !== "control_request") return;
    rpc.send({
      type: "control_response",
      response:
        record.request?.subtype === "can_use_tool"
          ? {
              subtype: "success",
              request_id: record.request_id,
              response: {
                ...(allowAllTools
                  ? {
                      behavior: "allow",
                      updatedInput: record.request.input ?? {},
                    }
                  : {
                      behavior: "deny",
                      message:
                        "Propose commands in an approve code block for user review.",
                    }),
              },
            }
          : {
              subtype: "error",
              request_id: record.request_id,
              error: "Unsupported unattended control request.",
            },
    });
  });
  const abort = () => {
    void rpc
      .request("interrupt", {}, 1000)
      .catch(() => {})
      .finally(() => rpc.shutdown());
  };
  opts?.signal?.addEventListener("abort", abort, { once: true });
  const close = () => {
    opts?.signal?.removeEventListener("abort", abort);
    removeControl();
    rpc.shutdown();
  };
  let initializationFailure: Error | undefined;
  const removeInit = rpc.onRecord((event) => {
    if (typeof event.session_id === "string" && event.session_id !== sessionId)
      initializationFailure = new Error(
        "Claude resumed a different session. No prompt was sent; the saved binding was preserved.",
      );
    if (event.type === "result" && event.is_error)
      initializationFailure = new Error(
        event.errors?.join("\n") ||
          event.result ||
          "Claude initialization failed.",
      );
  });
  try {
    opts?.signal?.throwIfAborted();
    const metadata = await rpc.request("initialize", { hooks: {} }, 20_000);
    if (initializationFailure) throw initializationFailure;
    return { rpc, metadata, sessionId, configDir, env, close };
  } catch (error) {
    close();
    throw initializationFailure ?? error;
  } finally {
    removeInit();
  }
}

export async function fetchClaudeModels(): Promise<ModelOption[]> {
  const { metadata, configDir, env, close } = await launchClaude();
  try {
    if (!Array.isArray(metadata.models))
      throw new Error(
        "Claude Code did not report its model catalog. Update the CLI and refresh models.",
      );
    const models = new Map<string, ModelOption>();
    const add = (
      id: string,
      title: string,
      extra: Partial<ModelOption> = {},
    ) => {
      const value = `${CLAUDE_PREFIX}${id}`;
      models.set(value, { value, title, ...extra });
    };
    for (const model of metadata.models) {
      if (
        typeof model.value !== "string" ||
        !model.value.trim() ||
        model.value === "default"
      )
        continue;
      add(model.value, model.displayName || model.value, {
        description: model.description,
        ...(model.resolvedModel
          ? { resolvedModel: `${CLAUDE_PREFIX}${model.resolvedModel}` }
          : {}),
      });
    }
    // The catalog's "default" row is the account recommendation, even when
    // user settings select another model. Resolve only the native model setting;
    // credentials and the rest of the configuration stay owned by the CLI.
    let configured: string | undefined;
    try {
      const value = JSON.parse(
        readFileSync(join(configDir, "settings.json"), "utf8"),
      ).model;
      if (typeof value === "string") configured = value;
    } catch {
      /* No user model override. */
    }
    const requested = env.ANTHROPIC_MODEL || configured;
    const active =
      requested && requested !== "default"
        ? metadata.models.find(
            (model: RecordValue) => model.value === requested,
          )?.resolvedModel || requested
        : metadata.models.find(
            (model: RecordValue) => model.value === "default",
          )?.resolvedModel;
    if (typeof active === "string" && active) {
      if (
        ![...models.values()].some(
          (model) =>
            model.value === `${CLAUDE_PREFIX}${active}` ||
            model.resolvedModel === `${CLAUDE_PREFIX}${active}`,
        )
      )
        add(active, active);
      models.set(CLAUDE_DEFAULT, {
        value: CLAUDE_DEFAULT,
        title: "Claude Code",
        resolvedModel: `${CLAUDE_PREFIX}${active}`,
      });
    }
    return [...models.values()];
  } finally {
    close();
  }
}

export async function runClaude(opts: RunOptions): Promise<RunResult> {
  const started = Date.now();
  const messages = new Map<string, Map<number, string>>();
  const steps: string[] = [];
  const toolIds = new Set<string>();
  let text = "";
  let current = "";
  let failure: unknown;
  let close = () => {};
  let removeEvent = () => {};
  let removeClose = () => {};
  const publish = () => {
    text = [...messages.values()]
      .map((blocks) =>
        [...blocks.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, value]) => value)
          .join(""),
      )
      .filter(Boolean)
      .join("\n\n");
    opts.onText?.(usesReviewedCommands(opts) ? splitCommands(text).text : text);
  };
  try {
    opts.signal?.throwIfAborted();
    const launch = await launchClaude(opts);
    close = launch.close;
    const { rpc, sessionId, configDir } = launch;
    const bindSession = (id: unknown) => {
      if (id !== sessionId)
        throw new Error(
          "Claude returned a different session ID. The saved binding was preserved.",
        );
      saveNativeSession(opts.sessionId, "claude", { id: sessionId, configDir });
    };
    await new Promise<void>((resolve, reject) => {
      removeClose = rpc.onClose(reject);
      removeEvent = rpc.onRecord((record) => {
        if (record.parent_tool_use_id) return;
        if (record.type === "system" && record.subtype === "init") {
          try {
            bindSession(record.session_id);
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (record.type === "stream_event") {
          const event = record.event;
          if (event?.type === "message_start") {
            current = event.message?.id || randomUUID();
            if (!messages.has(current)) messages.set(current, new Map());
          } else if (
            event?.type === "content_block_start" &&
            event.content_block?.type === "text"
          ) {
            messages
              .get(current)
              ?.set(event.index, event.content_block.text || "");
          } else if (
            event?.type === "content_block_delta" &&
            event.delta?.type === "text_delta"
          ) {
            const blocks = messages.get(current);
            if (blocks)
              blocks.set(
                event.index,
                (blocks.get(event.index) || "") + event.delta.text,
              );
            publish();
          }
        } else if (record.type === "assistant") {
          const id = record.message?.id || current || randomUUID();
          const blocks = new Map<number, string>();
          for (const [index, block] of (
            record.message?.content ?? []
          ).entries()) {
            if (block.type === "text") blocks.set(index, block.text);
            if (block.type === "tool_use" && !toolIds.has(block.id)) {
              toolIds.add(block.id);
              steps.push(claudeToolStep(block.name, block.input ?? {}));
              opts.onSteps?.([...steps]);
            }
          }
          messages.set(id, blocks);
          publish();
        } else if (record.type === "result") {
          try {
            bindSession(record.session_id);
          } catch (error) {
            reject(error);
            return;
          }
          if (record.is_error || record.subtype !== "success") {
            reject(
              new Error(
                record.errors?.join("\n") ||
                  record.result ||
                  "Claude request failed.",
              ),
            );
            return;
          }
          if (!text && typeof record.result === "string") {
            text = record.result;
            opts.onText?.(
              usesReviewedCommands(opts) ? splitCommands(text).text : text,
            );
          }
          resolve();
        }
      });
      try {
        opts.signal?.throwIfAborted();
        if (rpc.isClosed)
          throw new Error("Claude runtime stopped before the prompt was sent.");
        rpc.send(userMessage(opts.prompt));
      } catch (error) {
        reject(error);
      }
    });
  } catch (error) {
    failure = error;
  } finally {
    removeEvent();
    removeClose();
    close();
  }
  if (opts.signal?.aborted) failure = new Error("Stopped.");
  const result = finishResult("claude", opts, text, started, steps, failure);
  if (result.error?.message.startsWith("Claude Code CLI not found"))
    result.error.kind = "not-installed";
  return result;
}
