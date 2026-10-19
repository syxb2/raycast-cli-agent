<p align="center"><img src="assets/extension-icon-red.png" width="128" alt="Cli Agent"></p>

# Cli Agent

Author and maintainer: **Carol White**.

A Raycast extension for asking questions, chatting, translating and rewriting text through your locally configured **Codex CLI**, **Pi Agent CLI** or **Claude Code CLI**.

The repo is a fork of [CLI Assistant](https://github.com/umitaltintas/raycast-cli-assistant), originally created by umitaltintas.

The extension ID is `raycast-cli-agent`. Raycast treats it as separate from the original extension; the original extension's settings and chat history are not imported automatically.

## Release installation

The fork must publish a `raycast-cli-agent.tar.gz` release asset before this command can install it:

```bash
curl -fsSL https://raw.githubusercontent.com/syxb2/raycast-cli-agent/main/install.sh | bash
```

The installer downloads this repository's latest prebuilt extension and registers it with Raycast. Run it again to update. Uninstall through Raycast's extension action menu. Tagging `v*` runs the backend checks, builds and publishes the release package through GitHub Actions.

## Development

Requires macOS, Raycast v2, Node 22.22.2 or newer, and at least one locally configured CLI.

```bash
git clone https://github.com/syxb2/raycast-cli-agent.git
cd raycast-cli-agent
npm ci
npm run dev
```

Open Raycast's **Settings** command with the **Cli Agent** subtitle. Settings are organized into **General**, **Codex**, **Pi Agent** and **Claude Code**, with independent provider records, following Claudian's provider settings structure. Each provider remembers its own model selection.

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
| Claude Code | `CLAUDE_CONFIG_DIR`, defaulting to `~/.claude`; existing native authentication, user settings and provider environment | `claude --print --input-format stream-json --output-format stream-json`, control initialization and native session resume |
| Pi Agent | `PI_CODING_AGENT_DIR`, defaulting to `~/.pi/agent`; includes `settings.json`, `models.json` and `auth.json` | `pi --mode rpc`, state validation, prompt and streaming events |

**Codex third-party models:** configure `model`, `model_provider` and the corresponding `[model_providers.<name>]` section in your existing `config.toml`, as you would for the CLI. The provider's **Follow CLI Configuration** default resolves to that configured model. The backend does not pass `--ignore-user-config`, remove API keys or force the OpenAI provider. When the CLI explicitly reports that model discovery is unsupported for a third-party provider, its configured model remains available. Other discovery errors preserve the last complete catalog and are reported for retry.

**Model refresh:** catalogs are cached independently for each agent for up to 24 hours. Opening Model Browser or returning from Settings reuses valid catalogs and refreshes stale or failed agents; **Refresh Models** explicitly queries the CLI. Concurrent discoveries share one request per agent and configuration. Successful agents appear immediately while others are still loading. Configuration or credential changes invalidate discovered models and default aliases for every agent; explicitly entered Codex/Claude custom IDs remain available. A failed refresh keeps the previous complete catalog only when the agent configuration still matches, and does not extend its freshness or erase another agent’s error.

**Pi models:** **Follow CLI Configuration** resolves Pi's active model through its native state. Explicit selections use `pi:provider/model-id`; provider names and model IDs come from Pi's configured model registry. Chat menus show concrete models as `codex: model-id`, `pi: provider/model-id` or `claude: model-id`, with no selectable agent-only entries.

**Claude Code:** enable it in **Settings → Claude Code**, then choose **Save and Discover Models** or open **Model Browser** (⌘B). It is disabled by default for existing installations. Discovery uses the configured CLI's control initialization catalog without sending user input, without a model inference request or persisted probe session; it is not a remote model-access or billing check. The native catalog plus the user model setting/environment resolves **Follow CLI Configuration** to the active model. Aliases such as `sonnet` and `opus` keep the CLI-reported resolved model identity; extra models also accept custom gateway IDs. No hardcoded model-version list is used. Claude's existing authentication and `ANTHROPIC_*` / cloud-provider environment are inherited. Use `claude auth login` if authentication is needed.

Claude reasoning accepts Low, Medium, High, Extra High and Max, subject to the selected model and CLI version. A chat override wins over the provider default. Native metadata/control protocol and `--effort` support are required; unsupported CLI versions report an error. The adapter uses Claude Code's [CLI flags](https://code.claude.com/docs/en/cli-reference) and control wire protocol rather than installing an additional Agent SDK runtime.

**Environment:** a login shell supplies exported API keys, proxy variables and PATH that a GUI process may lack. These values remain in memory. Restart the extension process after changing shell exports. Changes to the global CLI configuration files invalidate the cached model catalog and create a fresh Codex runtime while retaining native thread bindings.

Each provider's **Configuration Directory** field overrides its environment variable. Its **CLI Path** can point at an installation outside the discovered PATH. Changing configuration directories requires starting a new chat or restoring the original directory before resuming an existing binding.

## Provider settings

The **Settings** command has four pages:

| Page | Settings |
| --- | --- |
| General | Default agent, primary and secondary languages, shared extra instructions |
| Codex | Enablement, CLI path, configuration directory, default/extra/visible models, aliases, reasoning effort, response style, verbosity, reasoning summary, web search, tools and environment overrides |
| Claude Code | Enablement, CLI path, configuration directory, model browser, default/extra/visible models, aliases, reasoning effort, web search, tools and environment overrides |
| Pi Agent | Enablement, CLI path, configuration directory, model browser, default/visible models, aliases, thinking level, thinking per model, tools and environment overrides |

Open **Model Browser** from the provider's action menu (⌘B). It supports search, filtering by model provider, selecting visible models, reordering, setting the default, and refreshing discovery. **Save and Discover Models** also saves edited paths/environment and queries only that agent.

For Pi, model discovery is checked with the same CLI and environment using `pi auth check --provider <provider> --json --no-refresh`. Only vendors Pi reports as `ready` appear in the browser. This supports Pi's own API key, OAuth, custom-provider and environment authentication rules without inspecting or copying credentials. A CLI supporting this command is required; unsupported or failed authentication checks produce an error instead of exposing unchecked models. Checks identify configured authentication; they do not send billable prompts or test individual models remotely.

Pi continues inheriting the interactive login shell's complete exported environment. A provider authenticated there can appear even when absent from Pi's `auth.json`. Use **Visible Models** to keep only the desired models in Chat. The visible list is an ordered whitelist intersected with the discovered catalog; defaults, remembered models and hand-entered Pi IDs cannot bypass it. A changed default resets the remembered selection for that agent. Removing a default selects another visible model. Clearing the list hides all of that agent's models and refreshing does not repopulate it.

On first authenticated discovery, legacy **Show all models** settings initialize to the native current model (or the first discovered model). Existing explicit visible selections are retained. Subsequent model discovery never automatically adds new models to the visible list. Changes to Pi's credential/configuration files or provider environment invalidate its cached eligibility, so stale authenticated models cannot reappear after a configuration change.

Valid setting changes are saved automatically, including when returning from a form. Incomplete or invalid input displays **Not Saved** and leaves the previous valid settings on disk. **Save Settings** also validates and saves explicitly. The default agent applies to the Chat command and **New Chat**; **New Chat with Agent** overrides it for that new conversation.

Reasoning uses the chat's explicit choice first, then Pi's model-specific thinking level (when configured), then the provider setting, then the native CLI default. Choose **Provider Default** in a chat to inherit these defaults.

At least one provider must remain enabled. Disabling the default agent selects another enabled agent as the default for new requests. Disabled agents disappear from new-chat and model menus and cannot receive new requests; existing chats retain their original binding and can resume when the agent is re-enabled.

Settings are stored as `settings.json` in the extension's support directory, with separate `general`, `providers.codex`, `providers.pi` and `providers.claude` records and file permissions `0600`. On first use, available legacy Raycast preferences and the previous selected model initialize this document. Subsequent changes use the Settings command rather than the old flat Raycast preference fields.

Environment overrides use literal `KEY=value` lines, optionally quoted. Shell substitutions are never evaluated. These manually entered overrides are saved locally; native authentication files are not copied. Changes to shell exports require restarting the extension process, while provider overrides take effect on subsequent requests.

## Commands

| Command | Behavior |
| --- | --- |
| Ask AI | Answer a question from a command argument or Raycast fallback search. An empty question opens Chat. |
| Chat | Multi-turn conversation bound to one agent; models can change within that agent. |
| Chat History | Search, reopen or delete local conversations. |
| Settings | Open General, Codex, Pi Agent and Claude Code configuration pages. |
| Ask About Selection | Ask a question about selected text, with clipboard fallback. |
| Ask About Finder Selection | Pass selected paths to the CLI for read-only file questions. |
| Fix Spelling and Grammar | Correct selected text and paste the result in place. |
| Improve Writing | Rewrite selected text more clearly and paste it in place. |
| Make Shorter | Shorten selected text and paste it in place. |
| Translate | Translate after a 600 ms typing pause, with remembered target language. |
| Translate and Replace | Translate the selection and replace it without opening a view. |
| Summarize / Explain | Summarize or explain selected text in the configured primary language, with clipboard fallback. |

Rewriting requires an actual selection. Auto translation uses the primary and secondary languages, checks direction and output language, and retries on the same selected backend/model. Short Auto inputs can make three concurrent requests for language classification and both translation directions.

On an answer: paste to the active app, copy, continue in Chat, regenerate, ask another model, or stop. Chat and answer views stream text and display tool steps. Codex, Pi and Claude Code stream native text updates.

## Tools and options

| Option | Behavior |
| --- | --- |
| Web Search | Independent checkbox for Codex's native search or Claude Code's WebSearch/WebFetch. Available in every tool permission mode; All Tools does not enable it automatically. |
| Tool Permissions | One selection per agent: No Tools, Read-only Tools or All Tools. New installations default to No Tools. Existing settings migrate to the matching permission. The current selection applies to every new request, including existing chats. |
| Reasoning Effort | Override Codex/Claude effort or Pi thinking level; support depends on the selected model. Choose Provider Default to inherit the provider and model settings. |
| Extra Instructions | Added to every request, including translation and rewriting. |
| Extra Models | Configured per provider; model IDs may omit that provider's `codex:`, `pi:` or `claude:` prefix. |

**No Tools** disables local CLI tools and configured integrations. Finder context and saved chat options cannot grant tool access. Web search remains independently available on Codex and Claude when its checkbox is enabled.

**Read-only Tools** enables Codex's shell tools within its read-only sandbox, Claude's Read/Glob/Grep, or Pi's read/grep/find/ls. Native mutations and configured MCP, plugin and extension tools remain disabled. Claude's invocation also disables hooks and slash commands in this mode.

**All Tools** enables direct commands, file edits and native configured integrations without application command review. Codex uses full access and retains native MCP configuration; Claude bypasses native permission checks and loads configured MCP, plugins, hooks and skills; Pi enables all discovered tools. Web search still follows its own setting: Codex passes an explicit live/disabled value, and Claude excludes WebSearch/WebFetch when disabled. Native disabled integrations and external account or administrator restrictions still apply. Model discovery remains restricted and never receives full tool access.

Settings and the chat's Tool Permissions submenu update the same agent permission. Changing agents never imports another agent's permission; queued requests resolve the current setting when they start. Web search and reasoning can still be overridden for an individual chat or answer.

In Read-only Tools mode, mutation commands may be proposed for manual review. Once approved, the extension runs the exact command in a local login shell and returns its output to the conversation. Those explicit user-approved actions execute outside the CLI's read-only restrictions. Commands have a 120-second timeout and at most 20,000 output characters are returned to the model.

Finder selection supplies context and a working directory when tools are permitted, not an exact-file access boundary. File tools may read additional files accessible to the CLI. The extension does not implement its own PDF or document parser.

## Local sessions

The extension keeps all chat management local:

- `conversations/<id>.json`: messages, model choices, options and timestamps; Raycast LocalStorage holds the searchable index.
- `sessions/bindings/<session-id>.json`: one fixed agent and its native session identity and configuration directory.
- Codex keeps its native rollout in its own configured home. The extension resumes the recorded thread through the current app-server.
- Claude keeps native history in its configured home; the extension saves the returned session ID and resumes that exact ID, checking native initialization metadata and validating the session ID reported by the run. One-shot requests and metadata probes disable session persistence.
- Pi session files are kept under the extension's `sessions/pi` directory and resumed by exact file path. The reported native identity is verified before any user prompt is sent.
- Before sending the first message, a new chat's model menu offers all enabled agents. Selecting another agent creates a fresh draft with its own session identity and defaults. After sending, the chat is bound to that agent and its model menu only shows that agent's models. Use **New Chat with Agent** to start another chat; conversation history is never replayed to another agent.
- Older single-agent bindings are converted when used. Old chats with multiple agent bindings must be replaced with a new chat; their stored history is retained.
- Requests targeting the same local session are serialized. Cancelling one Codex turn interrupts that turn without shutting down the shared server or other chats.
- Deleting a conversation removes its visible history and extension-owned binding. Native CLI session files are retained; deletion does not erase the CLI's independent history.

Previous `codex/threads.json` mappings from this extension are imported when first resumed. A missing or mismatched native session is reported as an error instead of silently starting a replacement conversation.
