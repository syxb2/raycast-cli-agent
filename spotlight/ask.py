#!/usr/bin/python3 -I
"""One-shot Spotlight helper using the selected Codex or Pi model and local config."""
import json
import os
import pwd
import re
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


def load_settings():
    try:
        with open(os.path.join(SUPPORT, "settings.json")) as source:
            settings = json.load(source)
        if settings.get("version") != 1:
            raise ValueError("Unsupported Cli Agent settings version.")
        return settings
    except FileNotFoundError:
        return {}


def current_model(settings=None):
    settings = load_settings() if settings is None else settings
    override = os.environ.get("RAYCAST_CLI_AGENT_MODEL", "")
    if override:
        return override
    if settings:
        provider = settings.get("general", {}).get("defaultProvider", "codex")
        config = settings.get("providers", {}).get(provider, {})
        default = config.get("defaultModel", f"{provider}:default")
        try:
            with open(os.path.join(SUPPORT, "current-models.json")) as source:
                saved = json.load(source).get(provider, {})
            model = saved.get("model", "")
            visible = config.get("visibleModels")
            if saved.get("defaultModel") == default and model.startswith(f"{provider}:") and (visible is None or model in visible or model == default):
                return model
        except (OSError, ValueError):
            pass
        return default
    try:
        with open(os.path.join(SUPPORT, "current-model")) as source:
            model = source.read().strip()
        if model.startswith(("codex:", "pi:")):
            return model
    except OSError:
        pass
    return "codex:default"


def environment_overrides(text):
    values = {}
    for index, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)", line)
        if not match:
            raise ValueError(f"Invalid environment variable on line {index}.")
        key, value = match.groups()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '\"'):
            value = value[1:-1]
        values[key] = value
    return values


def local_env(provider=None, config=None):
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
    if config:
        env.update(environment_overrides(config.get("environmentVariables", "")))
        if config.get("configDir"):
            env["CODEX_HOME" if provider == "codex" else "PI_CODING_AGENT_DIR"] = os.path.abspath(os.path.expanduser(config["configDir"]))
    return env


def binary_for(name, env, config=None):
    configured = (config or {}).get("cliPath", "").strip()
    if configured:
        path = os.path.abspath(os.path.expanduser(configured))
        return path if os.path.isfile(path) and os.access(path, os.X_OK) else None
    found = shutil.which(name, path=env["PATH"])
    if found:
        return found
    candidates = [f"{HOME}/{folder}/{name}" for folder in (".local/bin", ".npm-global/bin", ".bun/bin")]
    if name == "codex":
        candidates += [f"/Applications/{app}.app/Contents/Resources/codex" for app in ("Codex", "ChatGPT")]
    return next((path for path in candidates if os.access(path, os.X_OK)), None)


def ask(question, model, settings=None):
    settings = load_settings() if settings is None else settings
    provider, _, selected = model.partition(":")
    if provider not in ("codex", "pi"):
        return None, "Unsupported agent. Choose Codex or Pi Agent."
    config = settings.get("providers", {}).get(provider, {})
    if config.get("enabled") is False:
        return None, f"{provider} is disabled. Enable it in Cli Agent Settings."
    env = local_env(provider, config)
    binary = binary_for(provider, env, config)
    prompt = SYSTEM_PROMPT
    extra = settings.get("general", {}).get("extraInstructions", "").strip()
    if extra:
        prompt += "\n\n" + extra
    if not binary:
        return None, f"{provider} CLI not found."
    with tempfile.TemporaryDirectory() as work:
        if provider == "codex":
            answer = os.path.join(work, "answer.txt")
            args = [binary, "exec", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-o", answer]
            for setting in (
                f"developer_instructions={json.dumps(prompt)}",
                "features.shell_tool=false", "features.unified_exec=false",
                "features.apps=false", "features.plugins=false", 'web_search="disabled"',
            ):
                args += ["-c", setting]
            for key, field in (("model_reasoning_effort", "effort"), ("model_verbosity", "responseVerbosity"), ("model_reasoning_summary", "reasoningSummary")):
                value = config.get(field)
                if value and value != "default":
                    args += ["-c", f"{key}={json.dumps(value)}"]
            if selected != "default":
                args += ["-m", selected]
            args.append("-")
            input_text = question
        else:
            args = [binary, "--print", "--no-session", "--no-tools", "--no-extensions", "--no-mcp",
                    "--no-skills", "--no-prompt-templates", "--no-context-files", "--system-prompt", prompt]
            if selected != "default":
                api_provider, slash, model_id = selected.partition("/")
                if not slash or not api_provider or not model_id:
                    return None, "Pi models use pi:provider/model-id."
                args += ["--provider", api_provider, "--model", model_id]
            thinking = config.get("preferredThinkingByModel", {}).get(model) or config.get("thinkingLevel")
            if thinking:
                args += ["--thinking", thinking]
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
        settings = load_settings()
        text, error = ask(question, current_model(settings), settings)
        print(f"Error: {error}" if error else text)
    except (OSError, ValueError) as error:
        print(f"Error: {error}")


if __name__ == "__main__":
    main()
