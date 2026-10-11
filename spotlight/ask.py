#!/usr/bin/python3 -I
# Answers a question from stdin with the model chosen in the CLI Assistant
# Raycast extension (Claude Code or Codex). Used by the "Ask AI" app that
# install.sh --spotlight creates, so questions can be asked from Spotlight.
# CLI_ASSISTANT_MODEL overrides the model (e.g. for testing).
import json
import pwd
import os
import subprocess
import sys
import tempfile

HOME = os.path.expanduser("~")
SUPPORT = os.path.join(HOME, "Library/Application Support/com.raycast.macos/extensions/claude-cli")
SYSTEM_PROMPT = (
    "You are a concise, helpful assistant answering a quick question from macOS Spotlight. "
    "Answer directly in plain text without Markdown, in the language of the question. Keep it short."
)


def first_existing(paths):
    return next((p for p in paths if os.path.exists(p)), None)


def current_model():
    if os.environ.get("CLI_ASSISTANT_MODEL"):
        return os.environ["CLI_ASSISTANT_MODEL"]
    try:
        with open(os.path.join(SUPPORT, "current-model")) as f:
            return f.read().strip() or "haiku"
    except OSError:
        return "haiku"


def base_env():
    env = dict(os.environ)
    env.setdefault("USER", pwd.getpwuid(os.getuid()).pw_name)
    env.setdefault("LOGNAME", env["USER"])
    env["PATH"] = "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:" + env.get("PATH", "")
    return env


def ask_claude(question, model):
    binary = first_existing([f"{HOME}/.local/bin/claude", "/opt/homebrew/bin/claude", "/usr/local/bin/claude"])
    if not binary:
        return None, "Claude Code is not installed."
    env = base_env()
    env.pop("ANTHROPIC_API_KEY", None)
    # --setting-sources "" skips settings.json, so its proxy settings are passed on here.
    try:
        with open(f"{HOME}/.claude/settings.json") as f:
            for key, value in json.load(f).get("env", {}).items():
                if key.upper() in ("HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"):
                    env[key] = value
    except (OSError, ValueError):
        pass
    args = [binary, "-p", "--output-format", "text", "--tools", "", "--strict-mcp-config",
            "--setting-sources", "", "--disable-slash-commands", "--no-session-persistence",
            "--model", model, "--system-prompt", SYSTEM_PROMPT]
    os.makedirs(os.path.join(SUPPORT, "sessions"), exist_ok=True)
    p = subprocess.run(args, input=question, capture_output=True, text=True, env=env,
                       cwd=os.path.join(SUPPORT, "sessions"))
    if p.returncode != 0:
        return None, (p.stdout or p.stderr).strip() or "Claude Code failed."
    return p.stdout.strip(), None


def ask_codex(question, model):
    binary = first_existing(["/opt/homebrew/bin/codex", "/usr/local/bin/codex", f"{HOME}/.local/bin/codex",
                             "/Applications/ChatGPT.app/Contents/Resources/codex",
                             "/Applications/Codex.app/Contents/Resources/codex"])
    if not binary:
        return None, "Codex is not installed."
    env = base_env()
    env.pop("OPENAI_API_KEY", None)
    work = os.path.join(SUPPORT, "codex")
    os.makedirs(work, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        instructions = os.path.join(tmp, "instructions.md")
        answer = os.path.join(tmp, "answer.txt")
        with open(instructions, "w") as f:
            f.write(SYSTEM_PROMPT)
        # Same trimming as the extension: drops ~13k tokens of coding-agent context.
        trim = ["skills.include_instructions=false", "include_permissions_instructions=false",
                "include_apps_instructions=false", "include_collaboration_mode_instructions=false",
                "include_environment_context=false", "tools.update_plan.enabled=false",
                'web_search="disabled"', f"model_instructions_file={json.dumps(instructions)}"]
        trim += [f"features.{x}=false" for x in ("apps", "plugins", "multi_agent", "view_image",
                 "image_generation", "goals", "tool_suggest", "skill_search", "sleep_tool",
                 "browser_use", "computer_use")]
        args = [binary, "exec", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules",
                "-s", "read-only", "--ephemeral", "-o", answer]
        for kv in trim:
            args += ["-c", kv]
        slug = model[len("codex:"):]
        if slug and slug != "default":
            args += ["-m", slug]
        args.append("-")
        p = subprocess.run(args, input=question, capture_output=True, text=True, env=env, cwd=work)
        try:
            with open(answer) as f:
                text = f.read().strip()
        except OSError:
            text = ""
        if p.returncode != 0 or not text:
            lines = [l for l in (p.stderr or "").splitlines() if l.strip()]
            return None, lines[-1] if lines else "Codex failed."
        return text, None


def main():
    question = sys.stdin.read().strip()
    if not question:
        print("Type a question.")
        return
    model = current_model()
    text, error = (ask_codex if model.startswith("codex:") else ask_claude)(question, model)
    if error:
        print(f"Error: {error}")
        if any(k in error.lower() for k in ("not logged in", "login", "401", "unauthorized")):
            print("Sign in from a terminal: claude, then /login (or codex login).")
        return
    print(text)


main()
