import { build } from "esbuild";
import assert from "node:assert/strict";
import { test, after } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  chmodSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "cli-agent-test-"));
const codexDir = join(dir, "codex");
const piDir = join(dir, "pi");
for (const path of [codexDir, piDir]) {
  mkdirSync(path);
  writeFileSync(join(path, "fixture.json"), "{}");
}
const codexPath = join(dir, "fake-codex");
const piPath = join(dir, "fake-pi");
for (const path of [codexPath, piPath]) {
  copyFileSync("tests/fixtures/fake-cli.mjs", path);
  chmodSync(path, 0o755);
}
const preferences = {
  codexPath,
  piPath,
  codexHome: codexDir,
  piAgentDir: piDir,
  model: "codex:default",
  primaryLanguage: "English",
  secondaryLanguage: "Chinese",
};
Object.assign(process.env, {
  CLI_AGENT_TEST_SUPPORT: join(dir, "support"),
  CLI_AGENT_TEST_LOG: join(dir, "events.jsonl"),
  CLI_AGENT_TEST_PREFERENCES: JSON.stringify(preferences),
  OPENAI_API_KEY: "fixture-key",
  HTTPS_PROXY: "http://fixture-proxy",
  SHELL: "/bin/sh",
});
const outfile = join(dir, "backend.cjs");
await build({
  entryPoints: ["tests/fixtures/backend-entry.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  plugins: [
    {
      name: "raycast-test-host",
      setup(build) {
        build.onResolve({ filter: /^@raycast\/api$/ }, () => ({
          path: resolve("tests/fixtures/raycast.ts"),
        }));
      },
    },
  ],
});
const backend = (await import(pathToFileURL(outfile))).default;
const events = () =>
  readFileSync(process.env.CLI_AGENT_TEST_LOG, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
const requests = (method) =>
  events().filter(
    (e) =>
      e.event === "rpc" &&
      (e.record.method === method || e.record.type === method),
  );
async function until(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("Timed out waiting for fixture event");
}
after(() => {
  backend.shutdownCodexRuntimes();
  setTimeout(() => rmSync(dir, { recursive: true, force: true }), 100);
});

test("model routing supports Codex and Pi provider/model IDs", () => {
  assert.equal(backend.providerOf("codex:default"), "codex");
  assert.equal(backend.providerOf("pi:custom/model"), "pi");
  assert.deepEqual(backend.piModelId("pi:custom/org/model"), {
    provider: "custom",
    modelId: "org/model",
  });
  assert.throws(() => backend.providerOf("haiku"));
});

test("Codex preserves credentials, custom provider config, streaming and local thread resume", async () => {
  const sessionId = "codex-chat";
  const updates = [];
  const first = await backend.runModel({
    model: "codex:default",
    sessionId,
    prompt: "first",
    onText: (text) => updates.push(text),
  });
  assert.equal(first.isError, false, first.error?.message);
  assert.equal(first.text, "Answer: first");
  assert.ok(updates.includes("Answer: first"));
  const native = backend.loadNativeSession(sessionId, "codex", codexDir);
  assert.ok(native.id);
  const second = await backend.runModel({
    model: "codex:other-model",
    sessionId,
    prompt: "follow-up",
  });
  assert.equal(second.isError, false, second.error?.message);
  assert.equal(
    requests("thread/resume").at(-1).record.params.threadId,
    native.id,
  );
  assert.equal(
    requests("thread/start").at(-1).record.params.modelProvider,
    "custom",
  );
  assert.equal(
    requests("thread/start").at(-1).record.params.model,
    "third-party-model",
  );
  assert.equal(
    requests("turn/start").at(-1).record.params.model,
    "other-model",
  );
  const launch = events().find(
    (e) => e.provider === "codex" && e.event === "launch",
  );
  assert.equal(launch.keyPreserved, true);
  assert.equal(launch.proxyPreserved, true);
  assert.deepEqual(launch.args, ["app-server", "--listen", "stdio://"]);
});

test("a conversation cannot send input to another agent", async () => {
  const before = events().filter(
    (e) => e.provider === "pi" && e.event === "launch",
  ).length;
  const result = await backend.runModel({
    model: "pi:default",
    sessionId: "codex-chat",
    prompt: "forbidden agent switch",
  });
  assert.equal(result.isError, true);
  assert.match(result.error.message, /bound to codex/);
  assert.equal(
    events().filter((e) => e.provider === "pi" && e.event === "launch").length,
    before,
  );
});

test("Codex discovers the configured third-party model even without a catalog", async () => {
  writeFileSync(
    join(codexDir, "fixture.json"),
    JSON.stringify({ noCatalog: true }),
  );
  const models = await backend.fetchCodexModels();
  assert.ok(models.some((m) => m.value === "codex:third-party-model"));
  writeFileSync(join(codexDir, "fixture.json"), "{}");
});

test("a local config edit reloads Codex and resumes its original thread", async () => {
  const native = backend.loadNativeSession("codex-chat", "codex", codexDir);
  writeFileSync(join(codexDir, "config.toml"), 'model = "changed-model"');
  writeFileSync(
    join(codexDir, "fixture.json"),
    JSON.stringify({ model: "changed-model" }),
  );
  const result = await backend.runModel({
    model: "codex:default",
    sessionId: "codex-chat",
    prompt: "new configuration",
  });
  assert.equal(result.isError, false, result.error?.message);
  assert.equal(
    requests("thread/resume").at(-1).record.params.threadId,
    native.id,
  );
  assert.equal(
    requests("turn/start").at(-1).record.params.model,
    "changed-model",
  );
  assert.ok(
    new Set(
      events()
        .filter((e) => e.provider === "codex" && e.event === "launch")
        .map((e) => e.pid),
    ).size >= 2,
  );
});

test("cancelling a Codex turn interrupts only that thread and keeps the shared server", async () => {
  const controller = new AbortController();
  const count = requests("turn/start").length;
  const pending = backend.runModel({
    model: "codex:default",
    sessionId: "cancel-chat",
    prompt: "slow",
    signal: controller.signal,
  });
  await until(() => requests("turn/start").length > count);
  const independent = await backend.runModel({
    model: "codex:default",
    sessionId: "other-chat",
    prompt: "independent",
  });
  const pid = requests("turn/start").at(-1).pid;
  controller.abort();
  const stopped = await pending;
  assert.equal(stopped.error?.kind, "cancelled");
  assert.equal(independent.isError, false);
  const following = await backend.runModel({
    model: "codex:default",
    sessionId: "cancel-chat",
    prompt: "after cancellation",
  });
  assert.equal(following.isError, false);
  assert.equal(requests("turn/start").at(-1).pid, pid);
  assert.ok(requests("turn/interrupt").length);
});

test("native and proposed shell commands wait for UI approval", async () => {
  const codex = await backend.runModel({
    model: "codex:default",
    prompt: "approve",
    tools: true,
  });
  assert.deepEqual(codex.commands, ["touch reviewed.txt"]);
  await until(() =>
    events().some(
      (e) =>
        e.record?.id === "approval" && e.record?.result?.decision === "decline",
    ),
  );
  const pi = await backend.runModel({
    model: "pi:default",
    prompt: "approve",
    tools: true,
  });
  assert.deepEqual(pi.commands, ["touch reviewed.txt"]);
  assert.equal(pi.text, "Review this.");
  const launch = events()
    .filter((e) => e.provider === "pi" && e.event === "launch")
    .at(-1);
  assert.equal(
    launch.args[launch.args.indexOf("--tools") + 1],
    "read,grep,find,ls",
  );
  assert.ok(launch.args.includes("--no-mcp"));
});

test("Pi reuses local config and persists/resumes its exact native session", async () => {
  const first = await backend.runModel({
    model: "pi:default",
    sessionId: "pi-chat",
    prompt: "first",
  });
  assert.equal(first.isError, false, first.error?.message);
  const native = backend.loadNativeSession("pi-chat", "pi", piDir);
  assert.ok(native.file);
  const result = await backend.runModel({
    model: "pi:custom/org/model",
    sessionId: "pi-chat",
    prompt: "follow-up",
  });
  assert.equal(result.isError, false, result.error?.message);
  const launch = events()
    .filter((e) => e.provider === "pi" && e.event === "launch")
    .at(-1);
  assert.equal(launch.configDir, piDir);
  assert.ok(launch.args.includes(native.file));
  assert.ok(launch.args.includes("org/model"));
  assert.equal(backend.loadNativeSession("pi-chat", "pi", piDir).id, native.id);
});

test("Pi refuses a mismatched session before sending user text", async () => {
  const native = backend.loadNativeSession("pi-chat", "pi", piDir);
  const before = requests("prompt").length;
  writeFileSync(
    join(piDir, "fixture.json"),
    JSON.stringify({ mismatch: true }),
  );
  const result = await backend.runModel({
    model: "pi:default",
    sessionId: "pi-chat",
    prompt: "must not be delivered",
  });
  assert.equal(result.isError, true);
  assert.match(result.error.message, /different session/);
  assert.equal(requests("prompt").length, before);
  assert.deepEqual(backend.loadNativeSession("pi-chat", "pi", piDir), native);
  writeFileSync(join(piDir, "fixture.json"), "{}");
});

test("Pi waits through agent_end until final agent_settled and supports old completion", async () => {
  const result = await backend.runModel({
    model: "pi:default",
    prompt: "retry",
  });
  assert.equal(result.isError, false, result.error?.message);
  assert.match(result.text, /Recovered answer/);
  const legacy = await backend.runModel({
    model: "pi:default",
    prompt: "legacy",
  });
  assert.equal(legacy.isError, false, legacy.error?.message);
  assert.equal(legacy.text, "Legacy answer");
});

test("Pi discovers provider-qualified models and cancellation settles cleanly", async () => {
  const models = await backend.fetchPiModels();
  assert.ok(models.some((m) => m.value === "pi:custom/org/model/with-slash"));
  const controller = new AbortController();
  const before = requests("prompt").length;
  const pending = backend.runModel({
    model: "pi:default",
    prompt: "slow",
    signal: controller.signal,
  });
  await until(() => requests("prompt").length > before);
  controller.abort();
  assert.equal((await pending).error?.kind, "cancelled");
});

test("backend crashes return errors rather than leaving requests pending", async () => {
  for (const model of ["codex:default", "pi:default"]) {
    const result = await backend.runModel({ model, prompt: "crash" });
    assert.equal(result.isError, true);
  }
});

test("chat model menus contain only models from the bound agent", () => {
  const models = [
    { value: "codex:default", title: "Codex" },
    { value: "pi:default", title: "Pi" },
  ];
  assert.deepEqual(
    backend
      .modelsForProvider(models, "codex", "codex:older-model")
      .map((m) => m.value),
    ["codex:default", "codex:older-model"],
  );
  assert.deepEqual(
    backend.modelsForProvider(models, "pi").map((m) => m.value),
    ["pi:default"],
  );
});

test("native session bindings cannot be overwritten by another agent", () => {
  const native = backend.loadNativeSession("codex-chat", "codex", codexDir);
  assert.throws(
    () =>
      backend.saveNativeSession("codex-chat", "pi", {
        id: "foreign",
        configDir: piDir,
      }),
    /bound to codex/,
  );
  assert.deepEqual(
    backend.loadNativeSession("codex-chat", "codex", codexDir),
    native,
  );
  const saved = JSON.parse(
    readFileSync(
      join(dir, "support", "sessions", "bindings", "codex-chat.json"),
      "utf8",
    ),
  );
  assert.equal(saved.provider, "codex");
  assert.deepEqual(saved.native, native);
  assert.equal(saved.pi, undefined);
  assert.equal(saved.codex, undefined);
});

test("persisted chat agent is immutable while its model can change", async () => {
  const chat = backend.newConversation("codex:default");
  assert.equal(chat.provider, "codex");
  await backend.saveConversation(chat);
  await backend.saveConversation({ ...chat, model: "codex:another-model" });
  assert.equal(backend.loadConversation(chat.id).provider, "codex");
  await assert.rejects(
    backend.saveConversation({ ...chat, model: "pi:default" }),
    /must belong/,
  );
  await assert.rejects(
    backend.saveConversation({ ...chat, provider: "pi", model: "pi:default" }),
    /cannot be changed/,
  );
  await backend.deleteConversation(chat.id);
});

test("failed first requests still reserve the chat's agent", async () => {
  const failure = await backend.runModel({
    model: "pi:default",
    sessionId: "failed-first",
    prompt: "unsupported search",
    webSearch: true,
  });
  assert.equal(failure.isError, true);
  const before = requests("turn/start").length;
  const switched = await backend.runModel({
    model: "codex:default",
    sessionId: "failed-first",
    prompt: "must not be sent",
  });
  assert.equal(switched.isError, true);
  assert.match(switched.error.message, /bound to pi/);
  assert.equal(requests("turn/start").length, before);
});

test("local history saves concurrent chats and deleting one clears its binding", async () => {
  const a = backend.newConversation("codex:default");
  const b = backend.newConversation("pi:default");
  await Promise.all([backend.saveConversation(a), backend.saveConversation(b)]);
  assert.equal((await backend.listConversations()).length, 2);
  backend.saveNativeSession(a.sessionId, "codex", {
    id: "native",
    configDir: codexDir,
  });
  await backend.deleteConversation(a.id);
  assert.equal((await backend.listConversations()).length, 1);
  assert.equal(
    backend.loadNativeSession(a.sessionId, "codex", codexDir),
    undefined,
  );
});

test("changing config directories fails closed instead of losing conversation history", () => {
  assert.throws(
    () =>
      backend.loadNativeSession("pi-chat", "pi", join(dir, "another-account")),
    /different CLI configuration/,
  );
});

test("MCP overrides preserve valid transport config and exact server names", async () => {
  const result = await backend.runModel({
    model: "codex:default",
    prompt: "MCP override",
  });
  assert.equal(result.isError, false, result.error?.message);
  const config = requests("thread/start").at(-1).record.params.config;
  assert.deepEqual(config.mcp_servers, {
    xcode: { command: "fixture-mcp", enabled: false },
    "server.with.dots": { url: "https://example.invalid/mcp", enabled: false },
  });
});

test("old single-agent bindings migrate to the fixed-agent format", () => {
  const file = join(
    dir,
    "support",
    "sessions",
    "bindings",
    "legacy-single.json",
  );
  const native = {
    id: "legacy-native",
    file: "/legacy/session.jsonl",
    configDir: codexDir,
  };
  writeFileSync(file, JSON.stringify({ codex: native }));
  backend.claimSessionProvider("legacy-single", "codex");
  assert.deepEqual(
    backend.loadNativeSession("legacy-single", "codex", codexDir),
    native,
  );
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
    provider: "codex",
    native,
  });
});

test("old multi-agent bindings cannot be reused or silently rewritten", async () => {
  const file = join(
    dir,
    "support",
    "sessions",
    "bindings",
    "legacy-mixed.json",
  );
  const saved = JSON.stringify({
    codex: { id: "c", configDir: codexDir },
    pi: { id: "p", configDir: piDir },
  });
  writeFileSync(file, saved);
  const before = events().filter((e) => e.event === "launch").length;
  const result = await backend.runModel({
    model: "codex:default",
    sessionId: "legacy-mixed",
    prompt: "must not be sent",
  });
  assert.equal(result.isError, true);
  assert.match(result.error.message, /legacy chat/);
  assert.equal(events().filter((e) => e.event === "launch").length, before);
  assert.equal(readFileSync(file, "utf8"), saved);
});
