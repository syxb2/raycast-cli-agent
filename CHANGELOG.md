# CLI Assistant Changelog

## [Codex Models After Update] - 2026-10-11

- The model list is refreshed right away when an installed CLI has no models in the cached list, so Codex models show up after updating instead of a day later

## [Codex Support] - 2026-10-11

- Codex CLI as a second provider, signed in with your ChatGPT plan; also found inside the ChatGPT app
- Model menus group models by CLI; Codex models come from `codex debug models`
- Chats continue across providers: turns answered by the other CLI are sent as context
- Codex CLI Path preference; Default Model can be Codex's default model
- install.sh checks both CLIs

## [Reliable Auto Direction for Short Text] - 2026-10-11

- Short text in Auto mode: a separate Haiku call classifies the language while both directions are translated in parallel (~3 s); no more commentary when a short phrase was misdetected

## [Reverse Misdetected Translations] - 2026-10-11

- In Auto mode, a translation that comes back (almost) unchanged means the language was misdetected (common for short text without accents, e.g. "benim adim ne"); the direction is reversed and the text translated again
- Translate and Translate and Replace share the same translation logic

## [Fix Ask Showing "Stopped."] - 2026-10-11

- Ask AI (and Chat opened with a question) no longer stops right away. Raycast runs development extensions in React StrictMode, whose simulated unmount aborted the request before it could restart

## [English UI and Language Preferences] - 2026-10-11

- The whole extension, README and install script are in English
- New **Primary Language** and **Secondary Language** preferences (25 languages). Summaries, explanations and answers about selected text use the primary language; Translate's Auto mode translates between the two
- Language detection with franc instead of a Turkish-only word list; longer text is also checked for a third language
- Translations are sent with explicit source and target languages and the text in tags, which fixed untranslated and instruction-following outputs
- A translation in the wrong language is retried once with Sonnet

## [Icon Fix] - 2026-10-11

- Renamed the icon file so Raycast no longer shows a stale cached icon

## [One-Line Install] - 2026-10-11

- `install.sh` installs and updates the latest release without Node, npm or git
- GitHub Actions attaches a prebuilt package to every `v*` tag

## [Model List from the CLI] - 2026-10-11

- The model list comes from the Claude Code CLI for your plan, is cached and refreshed daily
- "Refresh Model List" in the model menus
- The Default Model preference uses aliases (haiku, sonnet, opus, fable), always the newest version

## [Model Selection] - 2026-10-11

- The chosen model is shared by all commands and remembered; change it from the menus in Chat and Translate or with ⌘⇧R on an answer
- The model can change mid-chat without losing context; every answer shows which model wrote it
- Extra Models preference for any name `claude --model` accepts

## [Initial Version] - 2026-10-11

- Ask, Chat and Chat History
- Selection commands: Ask About Selection, Fix Spelling and Grammar, Improve Writing, Make Shorter, Translate, Translate and Replace, Summarize, Explain
- Streamed answers, follow-up questions, 5-hour and weekly usage display
