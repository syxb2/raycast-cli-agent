<p align="center"><img src="assets/extension-icon.png" width="128" alt="CLI Assistant"></p>

# CLI Assistant

AI in Raycast without Raycast Pro: ask questions, chat, and fix, translate, summarize or explain selected text. Requests go through the [Claude Code](https://code.claude.com) CLI installed on your Mac and signed in with your own Claude account, so usage counts against your Claude plan, not Raycast AI credits.

> Not affiliated with, built by, or endorsed by Anthropic or Raycast.

## Install

Paste into a terminal:

```bash
curl -fsSL https://raw.githubusercontent.com/umitaltintas/raycast-cli-assistant/main/install.sh | bash
```

No Node, npm or git needed. The script downloads the prebuilt extension (~50 KB) from the [latest release](https://github.com/umitaltintas/raycast-cli-assistant/releases/latest), puts it into Raycast's extensions folder and registers it with Raycast. It also checks that Claude Code is installed and signed in. **Run the same command again to update**; chats and settings are kept. To uninstall, press <kbd>⌘</kbd><kbd>K</kbd> on any of its commands in Raycast → *Uninstall Extension*.

Then open the extension preferences and set your **Primary Language**.

> Extensions installed outside the Store show up in Raycast as development extensions and may require being signed in to a Raycast account. The script sends the same registration notification as `ray develop` (`raycast://cli/…`). That is not a documented Raycast interface, so if it ever changes, installing from source below always works.

<details>
<summary>Install from source (for development)</summary>

```bash
git clone https://github.com/umitaltintas/raycast-cli-assistant.git
cd raycast-cli-assistant
npm install
npm run dev   # once the extension shows up in Raycast you can stop it with Ctrl+C
```

Requires Node 22.22.2 or newer.

</details>

### Requirements

- Raycast v2 on macOS
- [Claude Code](https://code.claude.com/docs/en/quickstart), signed in with a paid Claude plan:

  ```bash
  curl -fsSL https://claude.ai/install.sh | bash
  claude   # then /login
  ```

## Commands

| Command | What it does |
| --- | --- |
| **Ask AI** | Takes a question from root search and streams the answer. Can be used as a fallback command. |
| **Chat** | A chat with follow-up questions. |
| **Chat History** | Open or delete previous chats. |
| **Ask About Selection** | Ask a question about the selected text. |
| **Fix Spelling and Grammar** · **Improve Writing** · **Make Shorter** | Rewrite the selected text and paste the result over it. |
| **Translate** | Translates as you type; selected text is filled in. The target language is remembered. |
| **Translate and Replace** | Translates the selected text without opening a window and pastes it over the selection. |
| **Summarize** · **Explain** | Summarize or explain the selected text (or the clipboard if nothing is selected), in your primary language. |

**Choosing a model:** from the dropdown in the search bar in Chat and Translate, or with <kbd>⌘</kbd><kbd>⇧</kbd><kbd>R</kbd> on an answer. The list is not hardcoded: it comes from the Claude Code CLI and matches your plan, so new models show up on their own. The chosen model is shared by all commands and remembered; switching mid-chat keeps the context.

On an answer: <kbd>↵</kbd> paste to the active app, <kbd>⌘</kbd><kbd>↵</kbd> continue in chat, <kbd>⌘</kbd><kbd>⇧</kbd><kbd>C</kbd> copy, <kbd>⌘</kbd><kbd>R</kbd> regenerate, <kbd>⌘</kbd><kbd>⇧</kbd><kbd>R</kbd> ask another model, <kbd>⌘</kbd><kbd>.</kbd> stop.

Tips:

- Make **Ask AI** a fallback command in Raycast settings: anything you type in root search that matches no command becomes a question with <kbd>↵</kbd>.
- Give your most used commands (Translate and Replace, Fix Spelling and Grammar) a hotkey.

## Preferences

| Preference | Description |
| --- | --- |
| Default Model | Haiku, Sonnet, Opus or Fable (aliases that always resolve to the newest version). A model you pick inside the extension overrides it. |
| Primary Language | Your main language. Summaries and explanations of selected text are written in it, and Translate's Auto mode translates into it. |
| Secondary Language | Translate's Auto mode translates text that is already in your primary language into this one. |
| Extra Models | Comma-separated models missing from your plan's list (e.g. `claude-opus-5-5[1m]`). |
| Claude CLI Path | Leave empty to try `~/.local/bin`, `/opt/homebrew/bin` and `/usr/local/bin`. |
| Extra Instructions | Appended to every request (tone, how to address you, etc.). |

## How it works

Every request runs `claude -p` in streaming (`stream-json`) mode. Claude Code is a coding agent, so everything a chat assistant doesn't need is turned off:

- tools (`--tools ""`), MCP servers (`--strict-mcp-config`), settings files (`--setting-sources ""`) and slash commands;
- a short assistant system prompt (`--system-prompt`) instead of Claude Code's coding prompt.

In my measurements this brings the time to the first answer from ~9 s down to ~3 s. `--bare` would be faster but only works with API keys and ignores Claude account logins.

More details:

- **Chats** are Claude Code sessions (`--session-id` / `--resume`). Their files are kept in the extension's own folder so they don't mix with your real projects.
- **Model list:** asked from the CLI's control protocol (the `initialize` request also behind the Agent SDK's `supportedModels()`); no model call, ~1 s. The result is cached and refreshed daily in the background; if the CLI is unreachable a fallback list of aliases is used.
- **Translation direction:** Auto mode is not left to the model, which was unreliable. The extension detects the language with [franc](https://github.com/wooorm/franc) and always sends one source and one target language. For short text it only decides "primary or secondary?", which is far more accurate than general detection; longer text is also checked for a third language.
- **Wrong-language check:** if a translation comes back in the wrong language (Haiku sometimes does this, e.g. German → Turkish), it is retried once with Sonnet and the result is marked.
- **Proxy:** `--setting-sources ""` skips user settings, so `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` from `~/.claude/settings.json` are read by the extension and passed to the CLI.
- **Raycast environment:** Raycast extension processes have no `USER` / `LOGNAME`; without them Claude Code can't find its Keychain login and says `Not logged in`. The extension sets them.
- If `ANTHROPIC_API_KEY` is set, the CLI would use it instead of your subscription, so it is removed from the child process.

## Terms

The extension does not collect, store or relay credentials. It only runs the unmodified Claude Code CLI that you installed, and sign-in happens through Anthropic's own flow. Your usage is subject to [Anthropic's terms](https://code.claude.com/docs/en/legal-and-compliance) and your plan's limits.

## License

MIT
