<p align="center"><img src="assets/extension-icon.png" width="128" alt="Cli Agent"></p>

# Cli Agent

Author and maintainer: **Carol White**.

A Raycast extension for asking questions, chatting, translating and rewriting text through your locally configured **Codex CLI** or **Pi Agent CLI**.

Based on [CLI Assistant](https://github.com/umitaltintas/raycast-cli-assistant), originally created by umitaltintas. The backend follows the native-process, RPC and session-binding approach used in the local `reference/claudian` project; it does not depend on that checkout at runtime.

The extension ID is `raycast-cli-agent`. Raycast treats it as separate from the original extension; the original extension's settings and chat history are not imported automatically.

## Development

Requires macOS, Raycast v2, Node 22.22.2 or newer, and at least one locally configured CLI.

```bash
git clone https://github.com/syxb2/raycast-cli-agent.git
cd raycast-cli-agent
npm ci
npm run dev
```

Choose **Codex (local configuration)** or **Pi Agent (local configuration)** in the extension's Default Model preference. The chosen model is shared across commands and remembered. Model menus also offer discovered models and manually entered Extra Models.

```bash
npm test                                     # Isolated backend protocol regression tests
npx eslint src tests                         # Source and test lint
npx prettier --check src tests package.json  # Formatting
npx ray build -e dist -o dist -I             # Build locally without installing into Raycast
```

`npm run lint` also validates Raycast Store metadata over the network. Its `author` field expects an existing Raycast account username; the current attribution `Carol White` may need a separate account username before Store publication.

## Local configuration

The extension preserves provider credentials and exported environment variables. It does not copy credential files into its own storage or rewrite the CLI's configuration.

| Backend | Configuration and authentication | Native protocol |
| --- | --- | --- |
| Codex | `CODEX_HOME`, defaulting to `~/.codex`; includes `config.toml`, configured model providers and existing CLI authentication | `codex app-server --listen stdio://`, JSON-RPC initialize, thread start/resume and turn notifications |
| Pi Agent | `PI_CODING_AGENT_DIR`, defaulting to `~/.pi/agent`; includes `settings.json`, `models.json` and `auth.json` | `pi --mode rpc`, state validation, prompt and streaming events |

**Codex third-party models:** configure `model`, `model_provider` and the corresponding `[model_providers.<name>]` section in your existing `config.toml`, as you would for the CLI. Choose **Codex (local configuration)** to use that configuration. The backend does not pass `--ignore-user-config`, remove API keys or force the OpenAI provider. A third-party provider without a model-list endpoint still exposes its configured model in the menu.

**Pi models:** choose **Pi Agent (local configuration)** to use Pi's locally resolved model. Explicit selections use `pi:provider/model-id`; provider names and model IDs come from Pi's configured model registry.

**Environment:** a login shell supplies exported API keys, proxy variables and PATH that a GUI process may lack. These values remain in memory. Restart the extension process after changing shell exports. Changes to the global CLI configuration files invalidate the cached model catalog and create a fresh Codex runtime while retaining native thread bindings.

Optional **Codex Configuration Directory** and **Pi Configuration Directory** preferences override the respective environment variables. CLI Path preferences can point at installations outside the discovered PATH. Changing configuration directories requires starting a new chat or restoring the original directory before resuming an existing binding.

## Commands

| Command | Behavior |
| --- | --- |
| Ask AI | Answer a question from a command argument or Raycast fallback search. An empty question opens Chat. |
| Chat | Multi-turn conversation bound to one agent; models can change within that agent. |
| Chat History | Search, reopen or delete local conversations. |
| Ask About Selection | Ask a question about selected text, with clipboard fallback. |
| Ask About Finder Selection | Pass selected paths to the CLI for read-only file questions. |
| Fix Spelling and Grammar | Correct selected text and paste the result in place. |
| Improve Writing | Rewrite selected text more clearly and paste it in place. |
| Make Shorter | Shorten selected text and paste it in place. |
| Translate | Translate after a 600 ms typing pause, with remembered target language. |
| Translate and Replace | Translate the selection and replace it without opening a view. |
| Summarize / Explain | Summarize or explain selected text in the configured primary language, with clipboard fallback. |

Rewriting requires an actual selection. Auto translation uses the primary and secondary languages, checks direction and output language, and retries on the same selected backend/model. Short Auto inputs can make three concurrent requests for language classification and both translation directions.

On an answer: paste to the active app, copy, continue in Chat, regenerate, ask another model, or stop. Chat and answer views stream text and display tool steps. Codex and Pi both stream native text updates.

## Tools and options

| Option | Behavior |
| --- | --- |
| Web Search | Codex's native search; only shown for Codex. Pi has no built-in web search in this extension. |
| Tools | Read files and propose shell commands for review. |
| Reasoning Effort | Override Codex effort or Pi thinking level; support depends on the selected model. Omit to retain the CLI default. |
| Extra Instructions | Added to every request, including translation and rewriting. |
| Extra Models | Comma-separated `codex:model-id` or `pi:provider/model-id`. Unprefixed values are treated as Codex models. |

Codex runs in a read-only sandbox and native approval requests are denied. Shell tools are disabled when file access is unnecessary. Pi exposes only `read,grep,find,ls` for file requests and disables its tools for plain text tasks. Extensions, MCP and plugin tools are disabled for these requests; this restriction does not replace model, provider or authentication settings.

Mutation commands are displayed for review. Once approved, the extension runs the exact command in a local login shell and returns its output to the conversation. Those approved commands execute outside the CLI's read-only restrictions. Commands have a 120-second timeout and at most 20,000 output characters are returned to the model.

Finder selection supplies context and a working directory, not an exact-file access boundary. File tools may read additional files accessible to the CLI. The extension does not implement its own PDF or document parser.

## Local sessions

The extension keeps all chat management local:

- `conversations/<id>.json`: messages, model choices, options and timestamps; Raycast LocalStorage holds the searchable index.
- `sessions/bindings/<session-id>.json`: one fixed agent and its native session identity and configuration directory.
- Codex keeps its native rollout in its own configured home. The extension resumes the recorded thread through the current app-server.
- Pi session files are kept under the extension's `sessions/pi` directory and resumed by exact file path. The reported native identity is verified before any user prompt is sent.
- Each chat is bound to Codex or Pi when created. Model menus only show that agent's models. Use **New Chat with Agent** to start with a different agent; conversation history is never replayed to another agent.
- Older single-agent bindings are converted when used. Old chats with multiple agent bindings must be replaced with a new chat; their stored history is retained.
- Requests targeting the same local session are serialized. Cancelling one Codex turn interrupts that turn without shutting down the shared server or other chats.
- Deleting a conversation removes its visible history and extension-owned binding. Native CLI session files are retained; deletion does not erase the CLI's independent history.

Previous `codex/threads.json` mappings from this extension are imported when first resumed. A missing or mismatched native session is reported as an error instead of silently starting a replacement conversation.

## Release installation

The fork must publish a `raycast-cli-agent.tar.gz` release asset before this command can install it:

```bash
curl -fsSL https://raw.githubusercontent.com/syxb2/raycast-cli-agent/main/install.sh | bash
```

The installer downloads this repository's latest prebuilt extension and registers it with Raycast. Run it again to update. Uninstall through Raycast's extension action menu. Tagging `v*` runs the backend checks, builds and publishes the release package through GitHub Actions.

Add `--spotlight` to create `~/Applications/Cli Agent.app`:

```bash
curl -fsSL https://raw.githubusercontent.com/syxb2/raycast-cli-agent/main/install.sh | bash -s -- --spotlight
```

Spotlight provides a separate, one-shot dialog using the extension's last chosen model. It uses `codex exec` or Pi print mode with the login shell's native configuration, preserves API keys and does not maintain chat history. Raycast-only configuration directory and CLI-path overrides do not apply to this helper; use the corresponding shell environment variables instead.
