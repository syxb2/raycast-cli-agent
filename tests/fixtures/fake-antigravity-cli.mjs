#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const provider = "antigravity";
const args = process.argv.slice(2);

function flagValue(name) {
  const index = args.indexOf(name);
  return index >= 0 && index + 1 < args.length ? args[index + 1] : undefined;
}

const geminiDir = flagValue("--gemini-dir");
const appDataDir = flagValue("--app-data-dir");
const configDir =
  geminiDir && appDataDir
    ? join(geminiDir, appDataDir)
    : join(process.env.HOME || "", ".gemini", "antigravity-cli");

const log = (entry) =>
  appendFileSync(
    process.env.CLI_AGENT_TEST_LOG,
    `${JSON.stringify({ provider, pid: process.pid, ...entry })}\n`,
  );

const send = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);

const flags = () => {
  try {
    return JSON.parse(readFileSync(join(configDir, "fixture.json"), "utf8"));
  } catch {
    return {};
  }
};

log({
  event: "launch",
  args,
  configDir,
  keyPreserved: process.env.OPENAI_API_KEY === "fixture-key",
  proxyPreserved: process.env.HTTPS_PROXY === "http://fixture-proxy",
});

let serverRequestId = 1;
const pendingClientRequests = new Map();
const slowPrompts = new Map();

function sendServerRequest(method, params) {
  const id = `srv-${serverRequestId++}`;
  return new Promise((resolve) => {
    pendingClientRequests.set(id, resolve);
    send({ jsonrpc: "2.0", id, method, params });
  });
}

function defaultSessionState(cfg) {
  const currentModelId = cfg.currentModelId ?? "gemini-4-argon";
  const modelOptions = cfg.modelOptions ?? [
    { value: "gemini-4-argon", name: "Gemini 4 Argon" },
    { value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
    { value: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
  ];
  const availableModels = cfg.availableModels ?? [
    { modelId: "gemini-4-argon-low", name: "Gemini 4 Argon (Low)" },
    { modelId: "gemini-4-argon-medium", name: "Gemini 4 Argon (Medium)" },
    { modelId: "gemini-4-argon-high", name: "Gemini 4 Argon (High)" },
    { modelId: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)" },
    { modelId: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)" },
    { modelId: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)" },
  ];
  const buildConfigOptions = (modelValue, thoughtValue, modeValue) => {
    if (cfg.noModels) return [];
    const options = [
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: modelValue,
        options: modelOptions,
      },
    ];
    if (modelValue !== "gpt-oss-120b-medium") {
      options.push({
        id: "thought_level",
        name: "Thinking Level",
        category: "thought_level",
        type: "select",
        currentValue: thoughtValue,
        options: [
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
        ],
      });
    }
    options.push({
      id: "mode",
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: modeValue,
      options: [
        { value: "default", name: "Default" },
        { value: "accept-edits", name: "Accept edits" },
        { value: "auto", name: "Auto" },
      ],
    });
    return options;
  };
  return {
    modelValue: currentModelId,
    thoughtValue: cfg.thoughtLevel ?? "medium",
    modeValue: "default",
    availableModels,
    buildConfigOptions,
  };
}

let sessionState = defaultSessionState(flags());

function respond(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function respondError(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function notify(sessionId, update) {
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, update },
  });
}

async function handleMessage(record) {
  if (!record.method && record.id !== undefined) {
    log({ event: "rpc_response", record });
    const resolve = pendingClientRequests.get(record.id);
    if (resolve) {
      pendingClientRequests.delete(record.id);
      resolve(record.result ?? {});
    }
    return;
  }

  log({ event: "rpc", record });
  const cfg = flags();

  if (record.method === "initialize") {
    respond(record.id, {
      protocolVersion: 1,
      agentCapabilities: {
        sessionCapabilities: { resume: {}, close: {} },
      },
    });
    return;
  }

  if (record.method === "session/new") {
    sessionState = defaultSessionState(cfg);
    const sessionId = randomUUID();
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, `${sessionId}.json`),
      JSON.stringify({ id: sessionId }),
    );
    respond(record.id, {
      sessionId,
      configOptions: sessionState.buildConfigOptions(
        sessionState.modelValue,
        sessionState.thoughtValue,
        sessionState.modeValue,
      ),
      models: cfg.noModels
        ? { availableModels: [], currentModelId: "" }
        : {
            availableModels: sessionState.availableModels,
            currentModelId: sessionState.modelValue,
          },
    });
    return;
  }

  if (record.method === "session/resume") {
    const requestedId = record.params?.sessionId;
    const path = join(configDir, `${requestedId}.json`);
    if (!requestedId || !existsSync(path)) {
      respondError(record.id, -32002, "Antigravity session missing");
      return;
    }
    sessionState = defaultSessionState(cfg);
    const sessionId = cfg.mismatch ? "wrong-session" : requestedId;
    respond(record.id, {
      sessionId,
      configOptions: sessionState.buildConfigOptions(
        sessionState.modelValue,
        sessionState.thoughtValue,
        sessionState.modeValue,
      ),
      models: cfg.noModels
        ? { availableModels: [], currentModelId: "" }
        : {
            availableModels: sessionState.availableModels,
            currentModelId: sessionState.modelValue,
          },
    });
    return;
  }

  if (record.method === "session/set_config_option") {
    const { configId, value } = record.params ?? {};
    if (configId === "model") {
      const known = new Set([
        ...sessionState.availableModels.map((m) => m.modelId),
        "gemini-4-argon",
        "gemini-3.8-flash",
        "gpt-oss-120b-medium",
      ]);
      if (!known.has(value)) {
        respondError(record.id, -32602, `Unknown model: ${value}`);
        return;
      }
      if (value.startsWith("gemini-4-argon-")) {
        sessionState.modelValue = "gemini-4-argon";
        sessionState.thoughtValue = value.slice("gemini-4-argon-".length);
      } else if (value.startsWith("gemini-3.8-flash-")) {
        sessionState.modelValue = "gemini-3.8-flash";
        sessionState.thoughtValue = value.slice("gemini-3.8-flash-".length);
      } else {
        sessionState.modelValue = value;
      }
    } else if (configId === "thought_level") {
      sessionState.thoughtValue = value;
    } else if (configId === "mode") {
      sessionState.modeValue = value;
    }
    respond(record.id, {
      configOptions: sessionState.buildConfigOptions(
        sessionState.modelValue,
        sessionState.thoughtValue,
        sessionState.modeValue,
      ),
    });
    return;
  }

  if (record.method === "session/close") {
    respond(record.id, {});
    return;
  }

  if (record.method === "session/cancel") {
    const resolveSlow = slowPrompts.get(record.params?.sessionId);
    if (resolveSlow) {
      slowPrompts.delete(record.params.sessionId);
      resolveSlow({ stopReason: "cancelled" });
    }
    return;
  }

  if (record.method === "session/prompt") {
    const sessionId = record.params?.sessionId;
    const text = record.params?.prompt?.[0]?.text ?? "";
    if (!text) throw new Error("Empty prompt must never be sent");
    if (text === "crash") process.exit(2);
    if (text === "error") {
      respondError(
        record.id,
        -32000,
        "authentication failed: run agy acp --login",
      );
      return;
    }
    if (text === "slow") {
      const outcome = await new Promise((resolve) => {
        slowPrompts.set(sessionId, resolve);
      });
      respond(record.id, outcome);
      return;
    }
    if (text === "web-search") {
      await sendServerRequest("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: "tc-web",
          name: "search_web",
          title: "search_web",
          rawInput: { query: "fixture" },
        },
        options: [
          { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
        ],
      });
      notify(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "tc-web",
        name: "search_web",
        rawInput: { query: "fixture" },
        status: "completed",
      });
    }
    if (text === "write-file") {
      await sendServerRequest("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: "tc-write",
          name: "write_file",
          title: "write_file",
          rawInput: { Path: "/tmp/out.txt" },
        },
        options: [
          { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
        ],
      });
    }
    if (text === "approve" || text === "approve-native") {
      await sendServerRequest("session/request_permission", {
        sessionId,
        toolCall: {
          toolCallId: "tc-cmd",
          name: "run_command",
          title: "run_command",
          rawInput: {
            CommandLine:
              text === "approve-native"
                ? "touch denied.txt"
                : "touch reviewed.txt",
          },
        },
        options: [
          { optionId: "allow-once", kind: "allow_once", name: "Allow once" },
        ],
      });
    }
    if (text === "ask-question") {
      const elRes = await sendServerRequest("elicitation/create", {
        sessionId,
        mode: "form",
        message: "Pick one",
        requestedSchema: {
          type: "object",
          properties: { choice: { type: "string" } },
        },
      });
      notify(sessionId, {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `Question outcome: ${elRes.action}` },
      });
      respond(record.id, { stopReason: "end_turn" });
      return;
    }
    if (text === "with-tool") {
      notify(sessionId, {
        sessionUpdate: "tool_call",
        toolCallId: "tc-read",
        name: "read_file",
        rawInput: { Path: "/tmp/sample.txt" },
        status: "in_progress",
      });
      notify(sessionId, {
        sessionUpdate: "tool_call_update",
        toolCallId: "tc-read",
        name: "read_file",
        rawInput: { Path: "/tmp/sample.txt" },
        status: "completed",
      });
    }

    const answer =
      text === "approve"
        ? "Review this.\n\n```approve\ntouch reviewed.txt\n```"
        : text === "approve-native"
          ? "Done."
          : `Antigravity answer: ${text}`;
    const split = Math.min(12, answer.length);
    notify(sessionId, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: answer.slice(0, split) },
    });
    setTimeout(() => {
      if (split < answer.length) {
        notify(sessionId, {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: answer.slice(split) },
        });
      }
      respond(record.id, { stopReason: "end_turn" });
    }, 40);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).replace(/\r$/, "");
    buffer = buffer.slice(newline + 1);
    if (line) void handleMessage(JSON.parse(line));
    newline = buffer.indexOf("\n");
  }
});
