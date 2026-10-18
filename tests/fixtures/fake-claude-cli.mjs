#!/usr/bin/env node
import { createInterface } from "node:readline";
import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const provider = "claude";
const args = process.argv.slice(2);
const configDir = process.env.CLAUDE_CONFIG_DIR;
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

const resume = args.find((arg) => arg.startsWith("--resume="))?.slice(9);
const explicit = args.find((arg) => arg.startsWith("--session-id="))?.slice(13);
const id = resume || explicit || randomUUID();
const path = join(configDir, `${id}.jsonl`);
const persistent = !args.includes("--no-session-persistence");
const cfg = flags();
const session = cfg.mismatch ? "wrong-session" : id;
const control = (record, response) =>
  send({
    type: "control_response",
    response: { subtype: "success", request_id: record.request_id, response },
  });
createInterface({ input: process.stdin }).on("line", (line) => {
  const record = JSON.parse(line);
  log({ event: "rpc", record });
  if (record.type === "control_request") {
    if (record.request.subtype === "initialize") {
      if (resume && !existsSync(path)) {
        send({
          type: "control_response",
          response: {
            subtype: "error",
            request_id: record.request_id,
            error: "Claude session missing",
          },
        });
      } else {
        send({
          type: "system",
          subtype: "ui_invalidate",
          session_id: session,
        });
        control(record, {
          models: cfg.models ?? [
            {
              value: "default",
              resolvedModel: cfg.model || "claude-sonnet-test",
              displayName: "Default",
            },
            {
              value: "sonnet",
              displayName: "Sonnet",
              resolvedModel: "claude-sonnet-test",
            },
            {
              value: "opus",
              displayName: "Opus",
              resolvedModel: "claude-opus-test",
            },
          ],
        });
      }
    } else if (record.request.subtype === "interrupt") control(record, {});
    return;
  }
  if (record.type !== "user") return;
  const prompt = record.message.content;
  if (!prompt) {
    throw new Error("Metadata discovery must never send an empty user prompt");
  }
  if (prompt === "crash") process.exit(2);
  if (prompt === "slow") return;
  if (prompt === "approve")
    send({
      type: "control_request",
      request_id: "deny-bash",
      request: {
        subtype: "can_use_tool",
        tool_name: "Bash",
        input: { command: "touch denied.txt" },
      },
    });
  send({
    type: "system",
    subtype: "init",
    session_id: session,
    model: "claude-sonnet-test",
  });
  if (persistent && !resume) writeFileSync(path, id);
  const messageId = randomUUID();
  const emit = (event) =>
    send({ type: "stream_event", session_id: session, event });
  const answer =
    prompt === "approve"
      ? "Review this.\n\n```approve\ntouch reviewed.txt\n```"
      : `Claude answer: ${prompt}`;
  emit({
    type: "message_start",
    message: { id: messageId, role: "assistant" },
  });
  emit({
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  });
  emit({
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: answer.slice(0, 7) },
  });
  setTimeout(() => {
    emit({
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: answer.slice(7) },
    });
    const message = {
      id: messageId,
      role: "assistant",
      content: [{ type: "text", text: answer }],
    };
    send({ type: "assistant", message, session_id: session });
    send({ type: "assistant", message, session_id: session });
    send({
      type: "result",
      subtype: prompt === "error" ? "error_during_execution" : "success",
      is_error: prompt === "error",
      errors: prompt === "error" ? ["authentication failed"] : [],
      result: answer,
      session_id: session,
    });
  }, 60);
});
