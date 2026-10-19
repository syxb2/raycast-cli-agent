import { build } from "esbuild";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";

const dir = mkdtempSync(join(tmpdir(), "cli-agent-chat-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const outfile = join(dir, "chat.cjs");
const fixture = resolve("tests/fixtures/chat-view-host.mjs");
await build({
  stdin: {
    contents: `export { ChatView } from "./src/components/ChatView";
      export { createHost } from "./tests/fixtures/chat-view-host.mjs";`,
    resolveDir: process.cwd(),
  },
  outfile,
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  plugins: [
    {
      name: "chat-view-host",
      setup(build) {
        build.onResolve({ filter: /.*/ }, ({ path, importer }) => {
          if (
            (importer.endsWith("ChatView.tsx") && path !== "../lib/chat") ||
            importer.endsWith("/src/lib/chat.ts")
          )
            return { path: fixture };
        });
      },
    },
  ],
});
const { ChatView, createHost } = (await import(pathToFileURL(outfile))).default;
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const rows = (tree) => tree.props.children;
const detail = (tree) => rows(tree)[0].props.detail.props.markdown;

for (const model of ["codex:test", "codex:other", "pi:test"]) {
  test(`late dropdown callback (${model}) preserves a pending fallback chat`, async () => {
    const host = createHost(ChatView, { firstQuestion: "Long question" });
    try {
      const initial = host.render();
      const onChange = initial.props.searchBarAccessory.props.onChange;
      const onOptions = initial.props.actions.props.children.find(
        (child) => child?.type === "OptionActions",
      ).props.onChange;
      const id = rows(initial)[0].props.id;
      assert.match(detail(initial), /thinking/);
      await tick();
      assert.equal(host.requests.length, 1);
      // Deliver events before React has even rendered the sent message.
      onChange(model);
      onOptions({ tools: true });
      const pending = host.render();
      assert.ok(Array.isArray(rows(pending)), "Pending message disappeared");
      assert.equal(rows(pending)[0].props.id, id);
      assert.equal(pending.props.selectedItemId, id);
      assert.match(detail(pending), /thinking/);
      host.stream.text = "Partial answer";
      assert.match(detail(host.render()), /Partial answer.*Generating/s);
      host.finish("Finished answer");
      await tick();
      const finished = host.render();
      assert.equal(rows(finished)[0].props.id, id);
      assert.match(detail(finished), /Finished answer/);
      assert.equal(host.requests.length, 1);
    } finally {
      host.dispose();
    }
  });
}

test("discovery finishing during a long fallback response preserves its detail", async () => {
  const host = createHost(ChatView, { firstQuestion: "Long question" });
  host.catalog.isRefreshing = true;
  try {
    const initial = host.render();
    const id = rows(initial)[0].props.id;
    const dropdown = initial.props.searchBarAccessory;
    assert.equal(dropdown.props.value, "codex:test");
    assert.equal(dropdown.props.defaultValue, "codex:test");
    assert.equal(dropdown.props.isLoading, undefined);
    await tick();
    assert.match(detail(host.render()), /thinking/);
    // Discovery adds models without hiding/remounting the cached selection.
    host.catalog.models = [
      ...host.catalog.models,
      { value: "codex:discovered", title: "Discovered" },
    ];
    host.catalog.isRefreshing = false;
    const discovered = host.render();
    assert.equal(discovered.props.searchBarAccessory.key, dropdown.key);
    assert.equal(
      discovered.props.searchBarAccessory.props.isLoading,
      undefined,
    );
    assert.equal(discovered.props.searchBarAccessory.props.value, "codex:test");
    assert.ok(
      discovered.props.searchBarAccessory.props.children[1].some((section) =>
        section.props.children.some(
          (item) => item.props.value === "codex:discovered",
        ),
      ),
    );
    discovered.props.searchBarAccessory.props.onChange("codex:test");
    assert.equal(rows(host.render())[0].props.id, id);
    assert.match(detail(host.tree), /thinking/);
    host.finish("Finished answer");
    await tick();
    assert.match(detail(host.render()), /Finished answer/);
    assert.equal(host.requests.length, 1);
  } finally {
    host.dispose();
  }
});

test("every fresh chat displays its cached model from the first render", () => {
  for (let launch = 0; launch < 3; launch++) {
    const host = createHost(ChatView, {});
    host.catalog.isRefreshing = true;
    try {
      host.render();
      const dropdown = host.frames[0].props.searchBarAccessory;
      assert.equal(dropdown.props.value, "codex:test");
      assert.equal(dropdown.props.defaultValue, "codex:test");
      assert.equal(dropdown.props.isLoading, undefined);
    } finally {
      host.dispose();
    }
  }
});

test("other agents' cached models do not show Select Model while the default loads", () => {
  const host = createHost(ChatView, {});
  host.catalog.models = [{ value: "pi:test", title: "Pi" }];
  host.catalog.isRefreshing = true;
  try {
    assert.equal(host.render().props.searchBarAccessory, undefined);
    host.catalog.models = [
      ...host.catalog.models,
      { value: "codex:test", title: "Test" },
    ];
    const dropdown = host.render().props.searchBarAccessory;
    assert.equal(dropdown.props.value, "codex:test");
    assert.equal(host.requests.length, 0);
  } finally {
    host.dispose();
  }
});

test("Select Model is shown when discovery finishes without an eligible default", () => {
  const host = createHost(ChatView, {});
  host.catalog.models = [{ value: "pi:test", title: "Pi" }];
  host.catalog.isRefreshing = true;
  try {
    host.render();
    host.catalog.isRefreshing = false;
    const dropdown = host.render().props.searchBarAccessory;
    assert.equal(dropdown.props.value, "");
    assert.equal(dropdown.props.children[0].props.title, "Select Model");
    dropdown.props.onChange("pi:test");
    assert.equal(host.render().props.searchBarAccessory.props.value, "pi:test");
  } finally {
    host.dispose();
  }
});

for (const firstQuestion of [undefined, "Long question"]) {
  for (const isRefreshing of [true, false]) {
    test(`Pi selection has no empty frame when models arrive (fallback=${Boolean(firstQuestion)}, refreshing=${isRefreshing})`, async () => {
      const host = createHost(ChatView, { firstQuestion });
      host.defaultModel = "pi:default";
      host.catalog.models = [{ value: "codex:test", title: "Codex" }];
      host.catalog.isRefreshing = true;
      try {
        assert.equal(host.render().props.searchBarAccessory, undefined);
        await tick();
        assert.equal(host.requests.length, 0);
        const model = "pi:deepseek/deepseek-flash";
        host.defaultModel = model;
        host.catalog.models = [
          ...host.catalog.models,
          { value: model, title: "DeepSeek" },
        ];
        host.catalog.isRefreshing = isRefreshing;
        const dropdown = host.render().props.searchBarAccessory;
        assert.equal(dropdown.props.value, model);
        // Check every emitted render, before effects normalize the conversation.
        for (const frame of host.frames) {
          const accessory = frame.props.searchBarAccessory;
          if (!accessory) continue;
          assert.equal(accessory.props.value, model, "Empty selection frame");
          assert.equal(accessory.props.defaultValue, model);
          const options = accessory.props.children.flatMap((child) =>
            Array.isArray(child)
              ? child.flatMap((section) => section.props.children)
              : child
                ? [child]
                : [],
          );
          assert.ok(options.some((option) => option.props.value === model));
          assert.ok(options.every((option) => option.props.value !== ""));
        }
        await tick();
        assert.equal(host.requests.length, firstQuestion ? 1 : 0);
        if (firstQuestion) {
          assert.equal(host.requests[0].model, model);
          host.finish("Finished answer");
          await tick();
          assert.match(detail(host.render()), /Finished answer/);
        }
      } finally {
        host.dispose();
      }
    });
  }
}

test("fallback without cached models waits for discovery before sending", async () => {
  const host = createHost(ChatView, { firstQuestion: "Long question" });
  const models = host.catalog.models;
  host.catalog.models = [];
  host.catalog.isRefreshing = true;
  try {
    const initial = host.render();
    const id = rows(initial)[0].props.id;
    assert.equal(initial.props.searchBarAccessory, undefined);
    await tick();
    assert.equal(host.requests.length, 0);
    assert.match(detail(host.render()), /thinking/);
    host.catalog.models = models;
    host.catalog.isRefreshing = false;
    const discovered = host.render();
    assert.equal(discovered.props.searchBarAccessory.props.value, "codex:test");
    await tick();
    assert.equal(host.requests.length, 1);
    assert.equal(rows(host.render())[0].props.id, id);
    host.finish("Finished answer");
    await tick();
    assert.match(detail(host.render()), /Finished answer/);
  } finally {
    host.dispose();
  }
});

test("a callback from an old chat cannot replace a new draft", () => {
  const host = createHost(ChatView, {});
  try {
    const initial = host.render();
    const onChange = initial.props.searchBarAccessory.props.onChange;
    // Selecting another agent remains possible before the first message.
    onChange("pi:test");
    const selected = host.render();
    assert.equal(selected.props.searchBarAccessory.props.value, "pi:test");
    selected.props.actions.props.children[1].props.onNew("codex");
    onChange("pi:test");
    assert.equal(
      host.render().props.searchBarAccessory.props.value,
      "codex:test",
    );
    assert.equal(host.requests.length, 0);
  } finally {
    host.dispose();
  }
});
