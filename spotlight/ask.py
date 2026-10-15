#!/usr/bin/python3 -I
"""One-shot Spotlight helper using the selected Codex or Pi model and local config."""
import json
import os
import pwd
import shutil
import subprocess
import sys
import tempfile

HOME = os.path.expanduser("~")
SUPPORT = os.path.join(HOME, "Library/Application Support/com.raycast.macos/extensions/raycast-cli-agent")
SYSTEM_PROMPT = (
    "You are a concise assistant answering a quick question from macOS Spotlight. "
    "Answer directly in plain text, in the language of the question. Keep it short."
)


def current_model():
    model = os.environ.get("RAYCAST_CLI_AGENT_MODEL", "")
    if not model:
        try:
            with open(os.path.join(SUPPORT, "current-model")) as source:
                model = source.read().strip()
        except OSError:
            pass
    return model if model.startswith(("codex:", "pi:")) else "codex:default"


def local_env():
    env = dict(os.environ)
    try:
        result = subprocess.run(
            [env.get("SHELL", "/bin/zsh"), "-ilc", "/usr/bin/env -0"],
            capture_output=True, timeout=5,
        )
        for item in result.stdout.decode(errors="replace").split("\0"):
            key, separator, value = item.partition("=")
            if separator and key.replace("_", "").isalnum() and not key[0].isdigit():
                env.setdefault(key, value)
    except (OSError, subprocess.TimeoutExpired):
        pass
    env.setdefault("USER", pwd.getpwuid(os.getuid()).pw_name)
    env.setdefault("LOGNAME", env["USER"])
    env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + env.get("PATH", "")
    return env


def binary_for(name, env):
    found = shutil.which(name, path=env["PATH"])
    if found:
        return found
    candidates = [f"{HOME}/{folder}/{name}" for folder in (".local/bin", ".npm-global/bin", ".bun/bin")]
    if name == "codex":
        candidates += [f"/Applications/{app}.app/Contents/Resources/codex" for app in ("Codex", "ChatGPT")]
    return next((path for path in candidates if os.access(path, os.X_OK)), None)


def ask(question, model):
    env = local_env()
    provider, _, selected = model.partition(":")
    binary = binary_for(provider, env)
    if not binary:
        return None, f"{provider} CLI not found."
    with tempfile.TemporaryDirectory() as work:
        if provider == "codex":
            answer = os.path.join(work, "answer.txt")
            args = [binary, "exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-o", answer]
            for setting in (
                f"developer_instructions={json.dumps(SYSTEM_PROMPT)}",
                "features.shell_tool=false", "features.unified_exec=false",
                "features.apps=false", "features.plugins=false", 'web_search="disabled"',
            ):
                args += ["-c", setting]
            if selected != "default":
                args += ["-m", selected]
            args.append("-")
            input_text = question
        else:
            args = [binary, "--print", "--no-session", "--no-tools", "--no-extensions", "--no-mcp",
                    "--no-skills", "--no-prompt-templates", "--no-context-files", "--system-prompt", SYSTEM_PROMPT]
            if selected != "default":
                api_provider, slash, model_id = selected.partition("/")
                if not slash or not api_provider or not model_id:
                    return None, "Pi models use pi:provider/model-id."
                args += ["--provider", api_provider, "--model", model_id]
            args += ["--", question]
            input_text = None
        try:
            result = subprocess.run(args, input=input_text, capture_output=True, text=True, env=env, cwd=work, timeout=120)
        except subprocess.TimeoutExpired:
            return None, "Request timed out after 120 seconds."
        if result.returncode:
            return None, (result.stderr or result.stdout).strip() or f"{provider} request failed."
        if provider == "codex":
            try:
                with open(answer) as source:
                    return source.read().strip(), None
            except OSError:
                return None, "Codex returned no answer."
        return result.stdout.strip(), None


def main():
    question = sys.stdin.read().strip()
    if not question:
        print("Type a question.")
        return
    try:
        text, error = ask(question, current_model())
        print(f"Error: {error}" if error else text)
    except OSError as error:
        print(f"Error: {error}")


if __name__ == "__main__":
    main()
