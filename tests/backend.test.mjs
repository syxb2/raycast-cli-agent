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
  statSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "cli-agent-test-"));
const codexDir = join(dir, "codex");
const piDir = join(dir, "pi");
const claudeDir = join(dir, "claude");
for (const path of [codexDir, piDir, claudeDir]) {
  mkdirSync(path);
  writeFileSync(join(path, "fixture.json"), "{}");
}
const codexPath = join(dir, "fake-codex");
const piPath = join(dir, "fake-pi");
const claudePath = join(dir, "fake-claude");
for (const path of [codexPath, piPath, claudePath]) {
  copyFileSync(
    path === claudePath
      ? "tests/fixtures/fake-claude-cli.mjs"
      : "tests/fixtures/fake-cli.mjs",
    path,
  );
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

test("legacy preferences initialize independent provider settings once", () => {
  const settings = backend.getSettings();
  assert.equal(settings.providers.codex.cliPath, codexPath);
  assert.equal(settings.providers.pi.cliPath, piPath);
  assert.equal(settings.providers.codex.configDir, codexDir);
  assert.equal(settings.providers.pi.configDir, piDir);
  assert.equal(settings.general.secondaryLanguage, "Chinese");
  const file = join(dir, "support", "settings.json");
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.ok(!readFileSync(file, "utf8").includes("fixture-key"));
  const previous = process.env.CLI_AGENT_TEST_PREFERENCES;
  process.env.CLI_AGENT_TEST_PREFERENCES = JSON.stringify({
    codexPath: "/different-cli",
  });
  assert.equal(backend.getProviderSettings("codex").cliPath, codexPath);
  process.env.CLI_AGENT_TEST_PREFERENCES = previous;
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

test("Codex and Pi publish partial text before the request completes", async () => {
  for (const model of ["codex:default", "pi:custom/pi-local-model"]) {
    const updates = [];
    let completed = false;
    const request = backend
      .runModel({
        model,
        prompt: "stream-chunks",
        onText: (text) => updates.push(text),
      })
      .then((result) => {
        completed = true;
        return result;
      });
    await until(() => updates.includes("第一段，"));
    assert.equal(completed, false, `${model} buffered its partial output`);
    const result = await request;
    assert.equal(result.isError, false, result.error?.message);
    assert.equal(result.text, "第一段，第二段。");
    assert.ok(updates.includes("第一段，第二段。"));
  }
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

test("older settings default all tool access to off for every agent", () => {
  const file = join(dir, "support", "settings.json");
  const original = readFileSync(file, "utf8");
  try {
    const stored = JSON.parse(original);
    for (const provider of ["codex", "pi", "claude"])
      delete stored.providers[provider].allowAllTools;
    writeFileSync(file, JSON.stringify(stored));
    for (const provider of ["codex", "pi", "claude"])
      assert.equal(backend.getProviderSettings(provider).allowAllTools, false);
  } finally {
    writeFileSync(file, original);
  }
});

for (const provider of ["codex", "pi", "claude"]) {
  test(`${provider} full tool access is independent and reversible in an existing chat`, async () => {
    const settings = backend.getProviderSettings(provider);
    const model = `${provider}:default`;
    const sessionId = `all-tools-${provider}`;
    const launchFor = () =>
      events()
        .filter((e) => e.provider === provider && e.event === "launch")
        .at(-1);
    const configDir = { codex: codexDir, pi: piDir, claude: claudeDir }[
      provider
    ];
    try {
      backend.updateProviderSettings(provider, {
        enabled: true,
        cliPath: { codex: codexPath, pi: piPath, claude: claudePath }[provider],
        configDir,
        allowAllTools: false,
      });
      const first = await backend.runModel({
        model,
        sessionId,
        prompt: "first",
      });
      assert.equal(first.isError, false, first.error?.message);
      const native = backend.loadNativeSession(sessionId, provider, configDir);

      backend.updateProviderSettings(provider, { allowAllTools: true });
      for (const other of ["codex", "pi", "claude"].filter(
        (p) => p !== provider,
      ))
        assert.equal(backend.getProviderSettings(other).allowAllTools, false);
      assert.deepEqual(
        backend.optionBadges({ tools: false, webSearch: false }, model),
        ["All Tools"],
      );
      const start = events().length;
      const full = await backend.runModel({
        model,
        sessionId,
        prompt: "approve",
        tools: true,
        webSearch: false,
      });
      assert.equal(full.isError, false, full.error?.message);
      assert.equal(full.commands, undefined);
      assert.equal(
        backend.loadNativeSession(sessionId, provider, configDir).id,
        native.id,
      );
      const launch = launchFor();
      if (provider === "codex") {
        const params = requests("thread/resume").at(-1).record.params;
        assert.equal(params.sandbox, "danger-full-access");
        assert.equal(params.approvalPolicy, "never");
        assert.equal(params.config.web_search, "live");
        for (const feature of [
          "shell_tool",
          "unified_exec",
          "apply_patch",
          "multi_agent",
          "apps",
          "plugins",
        ])
          assert.equal(params.config[`features.${feature}`], true);
        assert.equal(params.config.mcp_servers, undefined);
        assert.ok(
          !params.developerInstructions.includes("File tools are read-only"),
        );
        await until(() =>
          events()
            .slice(start)
            .some(
              (e) =>
                e.record?.id === "permissions-approval" &&
                e.record?.result?.permissions?.network?.enabled,
            ),
        );
        assert.ok(
          events()
            .slice(start)
            .some(
              (e) =>
                e.record?.id === "approval" &&
                e.record?.result?.decision === "accept",
            ),
        );
        assert.ok(
          events()
            .slice(start)
            .some(
              (e) =>
                e.record?.id === "file-approval" &&
                e.record?.result?.decision === "accept",
            ),
        );
        const grant = events()
          .slice(start)
          .find(
            (e) => e.record?.id === "permissions-approval" && e.record?.result,
          );
        assert.deepEqual(grant.record.result, {
          permissions: { network: { enabled: true } },
          scope: "turn",
        });

        // Another restricted request cannot inherit the full-access server.
        backend.updateProviderSettings(provider, { allowAllTools: false });
        const restricted = await backend.runModel({
          model,
          prompt: "isolated",
        });
        assert.equal(restricted.isError, false, restricted.error?.message);
        assert.equal(
          requests("thread/start").at(-1).record.params.sandbox,
          "read-only",
        );
        assert.notEqual(requests("thread/start").at(-1).pid, launch.pid);
      } else if (provider === "claude") {
        assert.equal(
          launch.args[launch.args.indexOf("--tools") + 1],
          "default",
        );
        assert.equal(
          launch.args[launch.args.indexOf("--permission-mode") + 1],
          "bypassPermissions",
        );
        for (const flag of [
          "--allowedTools",
          "--disallowedTools",
          "--strict-mcp-config",
          "--mcp-config",
          "--settings",
          "--disable-slash-commands",
        ])
          assert.ok(!launch.args.includes(flag));
        assert.equal(
          launch.args[launch.args.indexOf("--system-prompt-snapshot") + 1],
          "off",
        );
        assert.ok(
          !launch.args[launch.args.indexOf("--system-prompt") + 1].includes(
            "File tools are read-only",
          ),
        );
        await until(() =>
          events()
            .slice(start)
            .some((e) => e.record?.response?.request_id === "deny-bash"),
        );
        const reply = events()
          .slice(start)
          .find((e) => e.record?.response?.request_id === "deny-bash");
        assert.deepEqual(reply.record.response.response, {
          behavior: "allow",
          updatedInput: { command: "touch denied.txt" },
        });

        await backend.fetchClaudeModels();
        const probe = launchFor();
        assert.equal(probe.args[probe.args.indexOf("--tools") + 1], "");
        assert.equal(
          probe.args[probe.args.indexOf("--permission-mode") + 1],
          "default",
        );
        assert.ok(probe.args.includes("--strict-mcp-config"));
      } else {
        assert.equal(launch.args[launch.args.indexOf("--tools") + 1], "*");
        for (const flag of [
          "--no-tools",
          "--no-extensions",
          "--no-mcp",
          "--no-skills",
          "--no-context-files",
          "--no-prompt-templates",
        ])
          assert.ok(!launch.args.includes(flag));
        assert.ok(
          !launch.args[launch.args.indexOf("--system-prompt") + 1].includes(
            "File tools are read-only",
          ),
        );
        assert.equal(
          backend.loadNativeSession(sessionId, provider, configDir).file,
          native.file,
        );
      }

      backend.updateProviderSettings(provider, { allowAllTools: false });
      const revertedStart = events().length;
      const reverted = await backend.runModel({
        model,
        sessionId,
        prompt: "approve",
        tools: true,
        // Persisted/request options cannot override the provider setting.
        allowAllTools: true,
      });
      assert.equal(reverted.isError, false, reverted.error?.message);
      assert.deepEqual(reverted.commands, ["touch reviewed.txt"]);
      assert.deepEqual(backend.optionBadges({ tools: true }, model), ["Tools"]);
      assert.equal(
        backend.loadNativeSession(sessionId, provider, configDir).id,
        native.id,
      );
      if (provider === "codex") {
        const params = requests("thread/resume").at(-1).record.params;
        assert.equal(params.sandbox, "read-only");
        assert.equal(params.approvalPolicy, "on-request");
        assert.equal(params.config["features.apply_patch"], false);
        assert.equal(params.config.mcp_servers.xcode.enabled, false);
        assert.ok(
          params.developerInstructions.includes("File tools are read-only"),
        );
        await until(() =>
          events()
            .slice(revertedStart)
            .some(
              (e) =>
                e.record?.id === "permissions-approval" && e.record?.result,
            ),
        );
        const replies = events().slice(revertedStart);
        assert.equal(
          replies.find((e) => e.record?.id === "approval" && e.record?.result)
            .record.result.decision,
          "decline",
        );
        assert.equal(
          replies.find(
            (e) => e.record?.id === "file-approval" && e.record?.result,
          ).record.result.decision,
          "decline",
        );
        assert.deepEqual(
          replies.find(
            (e) => e.record?.id === "permissions-approval" && e.record?.result,
          ).record.result.permissions,
          {},
        );
      } else {
        const args = launchFor().args;
        assert.equal(
          args[args.indexOf("--tools") + 1],
          provider === "pi" ? "read,grep,find,ls" : "Read,Glob,Grep",
        );
        assert.ok(
          args.includes(provider === "pi" ? "--no-mcp" : "--strict-mcp-config"),
        );
        if (provider === "claude") {
          const reply = events()
            .slice(revertedStart)
            .find((e) => e.record?.response?.request_id === "deny-bash");
          assert.equal(reply.record.response.response.behavior, "deny");
        }
      }
    } finally {
      backend.updateProviderSettings(provider, settings);
    }
  });
}

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
    { value: "codex:test-model", title: "codex: test-model" },
    { value: "pi:custom/test-model", title: "pi: custom/test-model" },
  ];
  assert.deepEqual(
    backend.modelsForProvider(models, "codex").map((m) => m.value),
    ["codex:test-model"],
  );
  assert.deepEqual(
    backend.modelsForProvider(models, "pi").map((m) => m.value),
    ["pi:custom/test-model"],
  );
});

test("chat dropdown registers the selected model first during native initialization", () => {
  const models = [
    { value: "codex:test", title: "codex: test" },
    { value: "pi:deepseek/first", title: "pi: deepseek/first" },
    { value: "pi:deepseek/selected", title: "pi: deepseek/selected" },
  ];
  const groups = backend.groupByProvider(models, "pi:deepseek/selected");
  assert.equal(groups[0].provider, "pi");
  assert.equal(groups[0].models[0].value, "pi:deepseek/selected");
  assert.equal(groups[1].provider, "codex");
  assert.equal(models[0].value, "codex:test");
});

test("new chats offer Pi models and keep the selected agent after sending", async () => {
  const codex = backend.getProviderSettings("codex");
  const pi = backend.getProviderSettings("pi");
  let saved;
  try {
    backend.updateProviderSettings("codex", { webSearch: true, tools: false });
    backend.updateProviderSettings("pi", { tools: true });
    const draft = backend.newConversation(
      "codex:default",
      backend.defaultOptions("codex:default"),
    );
    const models = [
      { value: "codex:test-model", title: "codex: test-model" },
      { value: "pi:custom/another-model", title: "pi: custom/another-model" },
      { value: "pi:custom/pi-local-model", title: "Pi Model" },
    ];
    const choices = backend.chatModelChoices(draft, models);
    assert.ok(choices.some((m) => m.value === "pi:custom/pi-local-model"));
    const selected = backend.selectChatModel(draft, "pi:custom/pi-local-model");
    assert.equal(selected.provider, "pi");
    assert.equal(selected.model, "pi:custom/pi-local-model");
    assert.notEqual(selected.id, draft.id);
    assert.notEqual(selected.sessionId, draft.sessionId);
    assert.equal(selected.options.webSearch, undefined);
    assert.equal(selected.options.tools, true);
    assert.equal(selected.messages.length, 0);
    const sameAgent = backend.selectChatModel(
      selected,
      "pi:custom/another-model",
    );
    assert.equal(sameAgent.sessionId, selected.sessionId);
    assert.equal(sameAgent.id, selected.id);
    const sent = {
      ...selected,
      messages: [
        {
          id: "first",
          question: "Hello",
          answer: "",
          error: "Failed",
          createdAt: Date.now(),
        },
      ],
    };
    await backend.saveConversation(sent);
    saved = sent.id;
    assert.deepEqual(
      backend.chatModelChoices(sent, models).map((m) => m.value),
      ["pi:custom/another-model", "pi:custom/pi-local-model"],
    );
    assert.throws(
      () => backend.selectChatModel(sent, "codex:default"),
      /new chat/,
    );
    assert.throws(
      () => backend.claimSessionProvider(sent.sessionId, "codex"),
      /bound to pi/,
    );
  } finally {
    if (saved) await backend.deleteConversation(saved);
    backend.updateProviderSettings("codex", codex);
    backend.updateProviderSettings("pi", pi);
  }
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

test("provider settings isolate defaults and environment overrides", async () => {
  assert.equal(
    typeof backend.updateProviderSettings,
    "function",
    "Provider settings need independent persisted records",
  );
  const codex = backend.getProviderSettings("codex");
  const pi = backend.getProviderSettings("pi");
  try {
    backend.updateProviderSettings("codex", {
      effort: "high",
      webSearch: true,
      environmentVariables: "CLI_AGENT_SCOPE=codex",
    });
    backend.updateProviderSettings("pi", {
      thinkingLevel: "low",
      environmentVariables: "CLI_AGENT_SCOPE=pi",
    });
    assert.equal(backend.getProviderSettings("codex").effort, "high");
    assert.equal(backend.getProviderSettings("pi").thinkingLevel, "low");
    assert.equal(backend.defaultOptions("codex:default").effort, undefined);
    assert.equal(backend.defaultOptions("pi:default").effort, undefined);
    assert.equal(backend.defaultOptions("pi:default").webSearch, undefined);
    assert.equal(
      backend.providerEnvironment("codex", {}).CLI_AGENT_SCOPE,
      "codex",
    );
    assert.equal(backend.providerEnvironment("pi", {}).CLI_AGENT_SCOPE, "pi");
  } finally {
    if (typeof backend.updateProviderSettings === "function") {
      backend.updateProviderSettings("codex", codex);
      backend.updateProviderSettings("pi", pi);
    }
  }
});

test("provider model visibility, aliases and remembered choices are independent", async () => {
  const codex = backend.getProviderSettings("codex");
  const pi = backend.getProviderSettings("pi");
  try {
    await backend.refreshCatalog(true);
    backend.updateProviderSettings("codex", {
      customModels: ["codex:visible", "codex:hidden"],
      visibleModels: ["codex:visible"],
      modelAliases: { "codex:visible": "My Codex Model" },
    });
    backend.updateProviderSettings("pi", {
      customModels: ["pi:custom/undiscovered"],
      visibleModels: ["pi:custom/org/model/with-slash"],
      modelAliases: { "pi:custom/org/model/with-slash": "My Pi Model" },
    });
    const models = backend.availableModels();
    assert.ok(
      models.some(
        (m) =>
          m.value === "codex:visible" && m.title === "codex: My Codex Model",
      ),
    );
    assert.ok(!models.some((m) => m.value === "codex:hidden"));
    assert.ok(
      models.some(
        (m) =>
          m.value === "pi:custom/org/model/with-slash" &&
          m.title === "pi: My Pi Model",
      ),
    );
    backend.setCurrentModel("codex:visible");
    backend.setCurrentModel("pi:custom/org/model/with-slash");
    assert.equal(backend.currentModel("codex"), "codex:visible");
    assert.equal(backend.currentModel("pi"), "pi:custom/org/model/with-slash");
    backend.updateProviderSettings("codex", {
      defaultModel: "codex:new-default",
    });
    assert.equal(backend.currentModel("codex"), "codex:visible");
    assert.equal(backend.currentModel("pi"), "pi:custom/org/model/with-slash");
    assert.throws(
      () =>
        backend.updateProviderSettings("codex", { defaultModel: "pi:default" }),
      /Choose a codex model/,
    );
  } finally {
    backend.updateProviderSettings("codex", codex);
    backend.updateProviderSettings("pi", pi);
  }
});

test("native default models resolve to concrete prefixed menu entries", async () => {
  const general = backend.getSettings().general;
  const previous = backend.loadCatalog();
  const codex = backend.getProviderSettings("codex");
  const pi = backend.getProviderSettings("pi");
  try {
    backend.updateProviderSettings("codex", {
      visibleModels: null,
      defaultModel: "codex:default",
    });
    backend.updateProviderSettings("pi", {
      visibleModels: null,
      defaultModel: "pi:default",
    });
    await backend.refreshCatalog(true);
    const menu = backend.availableModels();
    assert.ok(menu.some((m) => m.value === "codex:changed-model"));
    assert.ok(menu.some((m) => m.value === "pi:custom/pi-local-model"));
    assert.ok(
      menu.every(
        (m) => m.value !== "codex:default" && m.value !== "pi:default",
      ),
    );
    assert.ok(
      menu.every((m) => m.title.startsWith(backend.providerOf(m.value) + ": ")),
    );
    assert.equal(
      backend.matchingValue("codex:default", menu),
      "codex:changed-model",
    );
    assert.equal(
      backend.matchingValue("pi:default", menu),
      "pi:custom/pi-local-model",
    );
    assert.equal(backend.modelLabel("pi:default"), "pi: custom/pi-local-model");
    backend.updateGeneralSettings({ defaultProvider: "pi" });
    const fromDisk = JSON.parse(
      readFileSync(join(dir, "support", "settings.json"), "utf8"),
    );
    assert.equal(fromDisk.general.defaultProvider, "pi");
    const chat = backend.newConversation(backend.currentModel());
    assert.equal(chat.provider, "pi");
    assert.ok(
      backend
        .chatModelChoices(chat, menu)
        .some((m) => m.value === "codex:changed-model"),
    );
  } finally {
    backend.updateProviderSettings("codex", codex);
    backend.updateProviderSettings("pi", pi);
    backend.updateGeneralSettings(general);
    if (previous) backend.saveCatalog(previous);
  }
});

test("a changed Pi runtime cannot reuse old authenticated models after discovery fails", async () => {
  const settings = backend.getProviderSettings("pi");
  const previous = backend.loadCatalog();
  try {
    const valid = await backend.refreshCatalog(true);
    assert.ok(valid.models.some((m) => m.value === "pi:custom/pi-local-model"));
    backend.updateProviderSettings("pi", { cliPath: join(dir, "missing-pi") });
    const failed = await backend.refreshCatalog(true);
    assert.match(failed.errors.pi, /CLI not found/);
    assert.equal(failed.fingerprint, "");
    assert.ok(
      !backend
        .availableModels()
        .some((m) => m.value === "pi:custom/pi-local-model"),
    );
    backend.updateProviderSettings("pi", settings);
    const recovered = await backend.refreshCatalog();
    assert.deepEqual(recovered.errors, {});
    assert.ok(recovered.fingerprint);
  } finally {
    backend.updateProviderSettings("pi", settings);
    if (previous) backend.saveCatalog(previous);
  }
});

test("Pi model browser trusts native auth and visible models cannot bypass it", async () => {
  const settings = backend.getProviderSettings("pi");
  const previous = backend.loadCatalog();
  const fixture = readFileSync(join(piDir, "fixture.json"), "utf8");
  const authFile = join(piDir, "auth.json");
  const priorAuth = existsSync(authFile) ? readFileSync(authFile) : undefined;
  try {
    writeFileSync(
      join(piDir, "fixture.json"),
      JSON.stringify({
        authReady: ["deepseek"],
        activeModel: { provider: "openrouter", id: "blocked" },
        models: [
          { provider: "deepseek", id: "chat" },
          { provider: "deepseek", id: "reasoner" },
          { provider: "openrouter", id: "blocked" },
        ],
      }),
    );
    backend.updateProviderSettings("pi", { visibleModels: null });
    const start = events().length;
    await backend.refreshProviderCatalog("pi");
    assert.deepEqual(
      backend.browserModels("pi").map((m) => m.value),
      ["pi:deepseek/chat", "pi:deepseek/reasoner"],
    );
    const probes = events()
      .slice(start)
      .filter((e) => e.event === "launch" && e.args[0] === "auth");
    assert.equal(probes.length, 2, "Check each vendor once, not each model");
    assert.ok(
      probes.every(
        (e) =>
          e.args.includes("--no-refresh") &&
          !e.args.includes("--credentials") &&
          e.configDir === piDir &&
          e.keyPreserved,
      ),
    );
    assert.deepEqual(backend.getProviderSettings("pi").visibleModels, [
      "pi:deepseek/chat",
    ]);
    backend.updateProviderSettings("pi", {
      visibleModels: ["pi:deepseek/reasoner", "pi:openrouter/blocked"],
      customModels: ["pi:openrouter/blocked"],
      defaultModel: "pi:openrouter/blocked",
    });
    backend.setCurrentModel("pi:openrouter/blocked");
    assert.equal(backend.currentModel("pi"), "pi:deepseek/reasoner");
    const available = backend
      .availableModels()
      .filter((m) => m.value.startsWith("pi:"));
    assert.deepEqual(
      available.map((m) => m.value),
      ["pi:deepseek/reasoner"],
    );
    assert.deepEqual(
      backend.chatModelChoices(
        {
          ...backend.newConversation("pi:openrouter/blocked"),
          messages: [{ question: "existing" }],
        },
        available,
      ),
      available,
    );
    backend.setVisibleModels("pi", []);
    await backend.refreshProviderCatalog("pi");
    assert.deepEqual(backend.getProviderSettings("pi").visibleModels, []);
    assert.equal(
      backend.availableModels().filter((m) => m.value.startsWith("pi:")).length,
      0,
    );
    backend.setVisibleModels("pi", ["pi:deepseek/chat"]);
    writeFileSync(authFile, "{}");
    assert.deepEqual(
      backend.browserModels("pi"),
      [],
      "Auth file changes invalidate cached eligibility immediately",
    );
    const cfg = JSON.parse(readFileSync(join(piDir, "fixture.json"), "utf8"));
    cfg.authReady = [];
    writeFileSync(join(piDir, "fixture.json"), JSON.stringify(cfg));
    await backend.refreshProviderCatalog("pi");
    assert.deepEqual(backend.browserModels("pi"), []);
    assert.equal(
      backend.availableModels().filter((m) => m.value.startsWith("pi:")).length,
      0,
    );
  } finally {
    writeFileSync(join(piDir, "fixture.json"), fixture);
    if (priorAuth) writeFileSync(authFile, priorAuth);
    else rmSync(authFile, { force: true });
    backend.updateProviderSettings("pi", settings);
    if (previous) backend.saveCatalog(previous);
  }
});

test("Pi discovery does not expose unverified models when native auth checks are unsupported", async () => {
  const file = join(piDir, "fixture.json");
  const previous = readFileSync(file, "utf8");
  try {
    writeFileSync(file, JSON.stringify({ authUnsupported: true }));
    await assert.rejects(backend.fetchPiModels(), /auth check/);
  } finally {
    writeFileSync(file, previous);
  }
});

test("provider response and thinking settings reach native CLI requests", async () => {
  const codex = backend.getProviderSettings("codex");
  const pi = backend.getProviderSettings("pi");
  try {
    backend.updateProviderSettings("codex", {
      effort: "high",
      responseVerbosity: "low",
      responseStyle: "friendly",
      reasoningSummary: "detailed",
    });
    const answer = await backend.runModel({
      model: "codex:default",
      prompt: "settings applied",
    });
    assert.equal(answer.isError, false, answer.error?.message);
    assert.equal(
      requests("thread/start").at(-1).record.params.config.model_verbosity,
      "low",
    );
    assert.match(
      requests("thread/start").at(-1).record.params.developerInstructions,
      /warm, friendly/,
    );
    assert.equal(requests("turn/start").at(-1).record.params.effort, "high");
    assert.equal(
      requests("turn/start").at(-1).record.params.summary,
      "detailed",
    );
    backend.updateProviderSettings("pi", {
      thinkingLevel: "off",
      preferredThinkingByModel: { "pi:custom/pi-local-model": "high" },
    });
    const result = await backend.runModel({
      ...backend.defaultOptions("pi:default"),
      model: "pi:default",
      prompt: "Pi settings applied",
    });
    assert.equal(result.isError, false, result.error?.message);
    const launch = events()
      .filter((e) => e.provider === "pi" && e.event === "launch")
      .at(-1);
    assert.equal(launch.args[launch.args.indexOf("--thinking") + 1], "off");
    assert.equal(requests("set_thinking_level").at(-1).record.level, "high");
    const before = requests("set_thinking_level").length;
    await backend.runModel({
      model: "pi:default",
      prompt: "Override model thinking",
      effort: "low",
    });
    assert.equal(requests("set_thinking_level").length, before);
  } finally {
    backend.updateProviderSettings("codex", codex);
    backend.updateProviderSettings("pi", pi);
  }
});

test("disabled providers are hidden and rejected without launching a CLI", async () => {
  const general = backend.getSettings().general;
  const pi = backend.getProviderSettings("pi");
  try {
    backend.updateGeneralSettings({ defaultProvider: "pi" });
    backend.updateProviderSettings("pi", { enabled: false });
    assert.equal(backend.getSettings().general.defaultProvider, "codex");
    assert.ok(
      backend
        .availableModels()
        .every((model) => backend.providerOf(model.value) === "codex"),
    );
    const before = events().filter((e) => e.event === "launch").length;
    const result = await backend.runModel({
      model: "pi:default",
      prompt: "must not be sent",
      sessionId: "pi-chat",
    });
    assert.equal(result.isError, true);
    assert.match(result.error.message, /disabled/);
    assert.equal(events().filter((e) => e.event === "launch").length, before);
    assert.throws(
      () => backend.updateProviderSettings("codex", { enabled: false }),
      /at least one/,
    );
    assert.equal(backend.getProviderSettings("codex").enabled, true);
  } finally {
    backend.updateProviderSettings("pi", pi);
    backend.updateGeneralSettings(general);
  }
});

test("provider environment overrides are literal and validated without shell evaluation", () => {
  assert.deepEqual(
    backend.parseEnvironmentVariables(
      "# comment\nTOKEN='a=b'\nexport EMPTY=\nLITERAL=$(touch /never-run)",
    ),
    { TOKEN: "a=b", EMPTY: "", LITERAL: "$(touch /never-run)" },
  );
  assert.throws(
    () => backend.parseEnvironmentVariables("INVALID LINE WITH A SECRET"),
    /line 1/,
  );
  const before = backend.getProviderSettings("pi");
  assert.throws(
    () =>
      backend.updateProviderSettings("pi", {
        environmentVariables: "INVALID VALUE",
      }),
    /line 1/,
  );
  assert.deepEqual(backend.getProviderSettings("pi"), before);
});

test("Claude is an independent opt-in provider with validated models and effort", () => {
  assert.equal(backend.providerOf("claude:sonnet"), "claude");
  assert.equal(backend.getProviderSettings("claude").enabled, false);
  assert.equal(backend.normalizeProviderModel("claude", "opus"), "claude:opus");
  assert.throws(() => backend.normalizeProviderModel("claude", "pi:default"));
  assert.deepEqual(
    backend.effortsForProvider("claude").map((e) => e.value),
    ["low", "medium", "high", "xhigh", "max"],
  );
  assert.throws(() =>
    backend.updateProviderSettings("claude", { effort: "off" }),
  );
});

test("Claude discovers native models, respects visibility, aliases and defaults", async () => {
  const settings = backend.getProviderSettings("claude");
  const previous = backend.loadCatalog();
  try {
    backend.updateProviderSettings("claude", {
      enabled: true,
      cliPath: claudePath,
      configDir: claudeDir,
    });
    const start = events().length;
    await backend.refreshProviderCatalog("claude");
    assert.equal(
      backend.modelLabel("claude:default"),
      "claude: claude-sonnet-test",
    );
    assert.equal(
      backend.sameModel("claude:sonnet", "claude:claude-sonnet-test"),
      true,
    );
    assert.equal(backend.currentModel("claude"), "claude:default");
    const launch = events()
      .slice(start)
      .find((e) => e.event === "launch");
    assert.ok(launch.args.includes("--no-session-persistence"));
    assert.ok(launch.keyPreserved && launch.proxyPreserved);
    assert.ok(
      events()
        .slice(start)
        .filter((e) => e.record?.type === "user").length === 0,
    );
    backend.updateProviderSettings("claude", {
      customModels: ["claude:claude-sonnet-test", "claude:default"],
    });
    assert.equal(
      backend
        .browserModels("claude")
        .filter((m) => backend.sameModel(m.value, "claude:sonnet")).length,
      1,
    );
    assert.ok(
      backend
        .browserModels("claude")
        .every((m) => m.value !== "claude:default"),
    );
    backend.setVisibleModels("claude", ["claude:opus"]);
    backend.updateProviderSettings("claude", {
      modelAliases: { "claude:claude-opus-test": "My Claude" },
    });
    assert.equal(
      backend.visibleProviderModels("claude")[0].title,
      "claude: My Claude",
    );
    assert.equal(
      backend.groupByProvider(backend.availableModels()).at(-1).provider,
      "claude",
    );
    backend.setVisibleModels("claude", []);
    await backend.refreshProviderCatalog("claude");
    assert.deepEqual(backend.visibleProviderModels("claude"), []);
  } finally {
    backend.updateProviderSettings("claude", settings);
    if (previous) backend.saveCatalog(previous);
  }
});

test("Claude streams without duplicate final text and resumes the bound native session", async () => {
  const settings = backend.getProviderSettings("claude");
  try {
    backend.updateProviderSettings("claude", {
      enabled: true,
      cliPath: claudePath,
      configDir: claudeDir,
      effort: "high",
    });
    const updates = [];
    const result = await backend.runModel({
      model: "claude:sonnet",
      sessionId: "claude-chat",
      prompt: "first",
      onText: (text) => updates.push(text),
    });
    assert.equal(result.isError, false, result.error?.message);
    assert.equal(result.text, "Claude answer: first");
    assert.ok(updates.includes("Claude "));
    const native = backend.loadNativeSession(
      "claude-chat",
      "claude",
      claudeDir,
    );
    assert.ok(native.id);
    const second = await backend.runModel({
      model: "claude:opus",
      sessionId: "claude-chat",
      prompt: "follow-up",
      effort: "low",
      webSearch: true,
      tools: true,
    });
    assert.equal(second.isError, false, second.error?.message);
    const launch = events()
      .filter((e) => e.provider === "claude" && e.event === "launch")
      .at(-1);
    assert.ok(launch.args.includes(`--resume=${native.id}`));
    assert.equal(launch.args[launch.args.indexOf("--model") + 1], "opus");
    assert.equal(launch.args[launch.args.indexOf("--effort") + 1], "low");
    assert.equal(
      launch.args[launch.args.indexOf("--tools") + 1],
      "Read,Glob,Grep,WebSearch,WebFetch",
    );
    assert.ok(launch.args.includes("--strict-mcp-config"));
    assert.equal(
      backend.loadNativeSession("claude-chat", "claude", claudeDir).id,
      native.id,
    );
    const denied = await backend.runModel({
      model: "pi:default",
      sessionId: "claude-chat",
      prompt: "never send",
    });
    assert.match(denied.error.message, /bound to claude/);
  } finally {
    backend.updateProviderSettings("claude", settings);
  }
});

test("Claude refuses wrong or missing native sessions before sending user text", async () => {
  const settings = backend.getProviderSettings("claude");
  const fixture = join(claudeDir, "fixture.json");
  try {
    backend.updateProviderSettings("claude", {
      enabled: true,
      cliPath: claudePath,
      configDir: claudeDir,
    });
    writeFileSync(fixture, JSON.stringify({ mismatch: true }));
    const start = events().length;
    const result = await backend.runModel({
      model: "claude:default",
      sessionId: "claude-chat",
      prompt: "must not be sent",
    });
    assert.match(result.error.message, /different session/);
    assert.ok(
      !events()
        .slice(start)
        .some((e) => e.record?.message?.content === "must not be sent"),
    );
    writeFileSync(fixture, "{}");
    backend.saveNativeSession("claude-missing", "claude", {
      id: "missing-native-session",
      configDir: claudeDir,
    });
    const missing = await backend.runModel({
      model: "claude:default",
      sessionId: "claude-missing",
      prompt: "must not be sent",
    });
    assert.match(missing.error.message, /session missing/);
  } finally {
    writeFileSync(fixture, "{}");
    backend.updateProviderSettings("claude", settings);
  }
});

test("Claude cancellation, crashes, errors and command approval settle safely", async () => {
  const settings = backend.getProviderSettings("claude");
  try {
    backend.updateProviderSettings("claude", {
      enabled: true,
      cliPath: claudePath,
      configDir: claudeDir,
    });
    const approval = await backend.runModel({
      model: "claude:default",
      prompt: "approve",
      tools: true,
    });
    assert.deepEqual(approval.commands, ["touch reviewed.txt"]);
    assert.equal(approval.text, "Review this.");
    const reply = events().findLast(
      (e) => e.record?.response?.request_id === "deny-bash",
    );
    assert.equal(reply.record.response.response.behavior, "deny");
    const crash = await backend.runModel({
      model: "claude:default",
      prompt: "crash",
    });
    assert.equal(crash.isError, true);
    const error = await backend.runModel({
      model: "claude:default",
      prompt: "error",
    });
    assert.equal(error.error.kind, "not-logged-in");
    const controller = new AbortController();
    const pending = backend.runModel({
      model: "claude:default",
      prompt: "slow",
      signal: controller.signal,
    });
    await until(() =>
      events().some(
        (e) => e.provider === "claude" && e.record?.message?.content === "slow",
      ),
    );
    controller.abort();
    assert.equal((await pending).error.kind, "cancelled");
    backend.updateProviderSettings("claude", {
      cliPath: join(dir, "missing-claude"),
    });
    const missing = await backend.runModel({
      model: "claude:default",
      prompt: "no CLI",
    });
    assert.equal(missing.error.kind, "not-installed");
  } finally {
    backend.updateProviderSettings("claude", settings);
  }
});

test("Claude CLI defaults follow native settings and environment without inference", async () => {
  const settings = backend.getProviderSettings("claude");
  const previous = backend.loadCatalog();
  const nativeSettings = join(claudeDir, "settings.json");
  try {
    backend.updateProviderSettings("claude", {
      enabled: true,
      cliPath: claudePath,
      configDir: claudeDir,
    });
    writeFileSync(nativeSettings, JSON.stringify({ model: "opus" }));
    await backend.refreshProviderCatalog("claude");
    assert.equal(
      backend.resolvedModel("claude:default"),
      "claude:claude-opus-test",
    );
    assert.deepEqual(backend.getProviderSettings("claude").visibleModels, [
      "claude:opus",
    ]);
    backend.updateProviderSettings("claude", {
      environmentVariables: "ANTHROPIC_MODEL=my-gateway-model",
      visibleModels: null,
      customModels: ["custom-other"],
    });
    await backend.refreshProviderCatalog("claude");
    assert.equal(
      backend.resolvedModel("claude:default"),
      "claude:my-gateway-model",
    );
    assert.ok(
      backend
        .browserModels("claude")
        .some((m) => m.value === "claude:custom-other"),
    );
    backend.updateProviderSettings("claude", {
      modelAliases: { "claude:opus": "Claude Opus" },
    });
    assert.equal(backend.modelLabel("claude:opus"), "claude: Claude Opus");
    writeFileSync(nativeSettings, JSON.stringify({ model: "sonnet" }));
    assert.deepEqual(
      backend.browserModels("claude").map((m) => m.value),
      ["claude:custom-other"],
      "Runtime changes invalidate discovered models while explicit custom IDs remain available",
    );
    backend.updateProviderSettings("claude", { enabled: false });
    const start = events().length;
    const result = await backend.runModel({
      model: "claude:default",
      prompt: "disabled",
    });
    assert.match(result.error.message, /disabled/);
    assert.equal(events().length, start);
  } finally {
    rmSync(nativeSettings, { force: true });
    backend.updateProviderSettings("claude", settings);
    if (previous) backend.saveCatalog(previous);
  }
});

test("Claude can be the sole enabled and default provider", () => {
  const previous = backend.getSettings();
  try {
    backend.updateProviderSettings("claude", { enabled: true });
    backend.updateProviderSettings("codex", { enabled: false });
    backend.updateProviderSettings("pi", { enabled: false });
    assert.equal(backend.getSettings().general.defaultProvider, "claude");
    assert.deepEqual(backend.enabledProviders(), ["claude"]);
    assert.throws(
      () => backend.updateProviderSettings("claude", { enabled: false }),
      /at least one/,
    );
  } finally {
    backend.updateProviderSettings("codex", previous.providers.codex);
    backend.updateProviderSettings("pi", previous.providers.pi);
    backend.updateProviderSettings("claude", previous.providers.claude);
    backend.updateGeneralSettings(previous.general);
  }
});

test("Codex reports catalog errors instead of treating incomplete discovery as successful", async () => {
  const file = join(codexDir, "fixture.json");
  const previous = readFileSync(file, "utf8");
  try {
    for (const fixture of [
      { catalogError: "model/list timed out." },
      { catalogError: "authentication failed" },
      { noCatalog: true, modelProvider: "openai" },
      { noCatalog: true, model: null },
      { catalogPages: [{ data: [], nextCursor: "0" }] },
      {
        catalogPages: [{ data: [{ model: "partial" }], nextCursor: "1" }],
        catalogPageError: true,
      },
      { catalogPages: [{ nextCursor: null }] },
      { model: null, catalogPages: [{ data: [], nextCursor: null }] },
    ]) {
      writeFileSync(file, JSON.stringify(fixture));
      await assert.rejects(
        backend.fetchCodexModels(),
        undefined,
        JSON.stringify(fixture),
      );
    }
    writeFileSync(file, JSON.stringify({ noCatalog: true }));
    const fallback = await backend.fetchCodexModels();
    assert.ok(fallback.some((m) => m.value === "codex:third-party-model"));
  } finally {
    writeFileSync(file, previous);
  }
});

test("full refresh preserves the last complete Codex catalog after an RPC failure and retries it", async () => {
  const file = join(codexDir, "fixture.json");
  const fixture = readFileSync(file, "utf8");
  const previous = backend.loadCatalog();
  try {
    writeFileSync(file, "{}");
    const valid = await backend.refreshCatalog(true);
    const codexModels = valid.models.filter((m) =>
      m.value.startsWith("codex:"),
    );
    writeFileSync(
      file,
      JSON.stringify({ catalogError: "temporary catalog failure" }),
    );
    const failed = await backend.refreshCatalog(true);
    assert.deepEqual(
      failed.models.filter((m) => m.value.startsWith("codex:")),
      codexModels,
    );
    assert.equal(failed.errors.codex, "temporary catalog failure");
    assert.equal(failed.providerFetchedAt.codex, valid.providerFetchedAt.codex);
    writeFileSync(file, "{}");
    const start = events().length;
    const recovered = await backend.refreshCatalog();
    assert.equal(recovered.errors.codex, undefined);
    assert.equal(
      events()
        .slice(start)
        .filter((e) => e.record?.method === "model/list").length,
      1,
    );
    assert.equal(
      events()
        .slice(start)
        .filter((e) => e.record?.type === "get_available_models").length,
      0,
    );
  } finally {
    writeFileSync(file, fixture);
    if (previous) backend.saveCatalog(previous);
  }
});
