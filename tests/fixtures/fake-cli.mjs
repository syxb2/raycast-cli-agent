#!/usr/bin/env node
import { createInterface } from "node:readline";
import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";

const provider = basename(process.argv[1]).includes("pi") ? "pi" : "codex";
const args = process.argv.slice(2);
const configDir =
  provider === "codex"
    ? process.env.CODEX_HOME
    : process.env.PI_CODING_AGENT_DIR;
const log = (entry) =>
  appendFileSync(
    process.env.CLI_AGENT_TEST_LOG,
    `${JSON.stringify({ provider, pid: process.pid, ...entry })}\n`,
  );
const send = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
const flags = () =>
  JSON.parse(readFileSync(join(configDir, "fixture.json"), "utf8"));
log({
  event: "launch",
  args,
  configDir,
  keyPreserved: process.env.OPENAI_API_KEY === "fixture-key",
  proxyPreserved: process.env.HTTPS_PROXY === "http://fixture-proxy",
});
if (provider === "pi" && args[0] === "auth") {
  const cfg = flags();
  const name = args[args.indexOf("--provider") + 1];
  if (cfg.authUnsupported) {
    process.stdout.write("unsupported auth command\n");
    process.exit(1);
  }
  const ready = (cfg.authReady ?? ["custom"]).includes(name);
  send({
    provider: name,
    status: ready ? "ready" : "not_ready",
    ...(ready
      ? { authType: "api_key" }
      : { reason: "credentials_not_configured" }),
  });
  process.exit(ready ? 0 : 1);
}
let sessionId;
let sessionFile;
if (provider === "pi") {
  const index = args.indexOf("--session");
  if (index !== -1) {
    sessionFile = args[index + 1];
    sessionId = readFileSync(sessionFile, "utf8");
  } else {
    sessionId = randomUUID();
    const dirIndex = args.indexOf("--session-dir");
    if (dirIndex !== -1) {
      sessionFile = join(args[dirIndex + 1], `${sessionId}.jsonl`);
      writeFileSync(sessionFile, sessionId);
    }
  }
}
const turns = new Map();
function codexNotice(method, params) {
  send({ method, params });
}
function codexFinish(threadId, turnId, text, status = "completed") {
  codexNotice("item/agentMessage/delta", {
    threadId,
    turnId,
    itemId: turnId,
    delta: text,
  });
  codexNotice("item/completed", {
    threadId,
    turnId,
    item: { type: "agentMessage", id: turnId, text },
  });
  codexNotice("turn/completed", {
    threadId,
    turn: { id: turnId, status, items: [] },
  });
}
function piMessages(text) {
  send({ type: "message_start", message: { role: "assistant" } });
  send({
    type: "message_update",
    assistantMessageEvent: { type: "text_delta", delta: text },
  });
  send({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const record = JSON.parse(line);
  log({ event: "rpc", record });
  const method = provider === "codex" ? record.method : record.type;
  const reply = (data = {}) =>
    send(
      provider === "codex"
        ? { id: record.id, result: data }
        : {
            type: "response",
            id: record.id,
            command: method,
            success: true,
            data,
          },
    );
  const cfg = flags();
  if (provider === "codex") {
    const p = record.params || {};
    if (method === "initialize") reply({});
    if (method === "config/read")
      reply({
        config: {
          model: cfg.model || "third-party-model",
          model_provider: "custom",
          model_reasoning_effort: "medium",
          mcp_servers: {
            xcode: {
              command: "fixture-mcp",
              enabled: true,
              tool_timeout_sec: null,
            },
            "server.with.dots": {
              url: "https://example.invalid/mcp",
              enabled: true,
            },
          },
        },
      });
    if (method === "model/list") {
      if (cfg.noCatalog)
        send({
          id: record.id,
          error: { code: -1, message: "catalog unavailable" },
        });
      else
        reply({
          data: [{ model: "catalog-model", displayName: "Catalog Model" }],
          nextCursor: null,
        });
    }
    if (method === "thread/start" || method === "thread/resume") {
      const id = p.threadId || randomUUID();
      const path = join(configDir, `${id}.jsonl`);
      if (method === "thread/resume" && !existsSync(path)) {
        send({ id: record.id, error: { code: -1, message: "thread missing" } });
      } else {
        writeFileSync(path, id);
        reply({ thread: { id, path } });
      }
    }
    if (method === "turn/start") {
      const threadId = p.threadId;
      const turnId = randomUUID();
      const prompt = p.input[0].text;
      turns.set(turnId, threadId);
      codexNotice("turn/started", { threadId, turn: { id: turnId } });
      // Notifications deliberately race ahead of the request response.
      if (prompt === "slow") {
        reply({ turn: { id: turnId } });
        return;
      }
      if (prompt === "crash") {
        process.exit(2);
      }
      if (prompt === "approve")
        send({
          id: "approval",
          method: "item/commandExecution/requestApproval",
          params: { threadId, turnId, command: "touch reviewed.txt" },
        });
      codexFinish(
        threadId,
        turnId,
        prompt === "approve" ? "Review this command." : `Answer: ${prompt}`,
      );
      reply({ turn: { id: turnId } });
    }
    if (method === "turn/interrupt") {
      codexFinish(p.threadId, p.turnId, "", "interrupted");
      reply();
    }
    if (method === "thread/unsubscribe") reply();
  } else {
    if (method === "get_state")
      reply({
        sessionId: cfg.mismatch ? "wrong-id" : sessionId,
        sessionFile,
        model: cfg.activeModel ?? { id: "pi-local-model", provider: "custom" },
      });
    if (method === "get_available_models")
      reply({
        models: cfg.models ?? [
          { id: "pi-local-model", provider: "custom", name: "Pi Local" },
          { id: "org/model/with-slash", provider: "custom", name: "Pi Custom" },
          {
            id: "unconfigured-model",
            provider: "unconfigured",
            name: "Not Configured",
          },
        ],
      });
    if (method === "prompt") {
      send({ type: "agent_start" });
      const prompt = record.message;
      if (prompt === "slow") {
        reply({ disposition: "started" });
        return;
      }
      if (prompt === "crash") process.exit(2);
      if (prompt === "legacy") {
        piMessages("Legacy answer");
        send({ type: "agent_end", willRetry: false });
        reply({});
        return;
      }
      reply({ disposition: "started" });
      if (prompt === "retry") {
        piMessages("First attempt");
        send({ type: "agent_end", willRetry: false });
        setTimeout(() => {
          send({ type: "agent_start" });
          piMessages("Recovered answer");
          send({ type: "agent_end", willRetry: false });
          send({ type: "agent_settled" });
        }, 40);
      } else {
        piMessages(
          prompt === "approve"
            ? "Review this.\n\n```approve\ntouch reviewed.txt\n```"
            : `Pi answer: ${prompt}`,
        );
        send({ type: "agent_end", willRetry: false });
        send({ type: "agent_settled" });
      }
    }
    if (method === "set_thinking_level") reply();
    if (method === "abort") {
      reply();
      send({ type: "agent_settled" });
    }
  }
});
