# CLI Assistant Changelog

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
