import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("Spotlight shares provider defaults, overrides and enablement", () => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      String.raw`
import importlib.util
import json
import os
import tempfile
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("spotlight_helper", "spotlight/ask.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
with tempfile.TemporaryDirectory() as root:
    helper.SUPPORT = root
    settings = {
        "version": 1,
        "general": {"defaultProvider": "pi", "extraInstructions": "Use short answers."},
        "providers": {
            "codex": {"enabled": True, "defaultModel": "codex:default", "cliPath": "/bin/echo"},
            "pi": {"enabled": True, "defaultModel": "pi:custom/base", "visibleModels": None,
                   "thinkingLevel": "low", "preferredThinkingByModel": {"pi:custom/chosen": "high"},
                   "environmentVariables": "SCOPED='pi=value'", "configDir": root},
        },
    }
    with open(os.path.join(root, "settings.json"), "w") as output:
        json.dump(settings, output)
    with open(os.path.join(root, "current-models.json"), "w") as output:
        json.dump({"codex": {"model": "codex:other", "defaultModel": "codex:default"},
                   "pi": {"model": "pi:custom/chosen", "defaultModel": "pi:custom/base"}}, output)
    with patch.dict(os.environ, {"RAYCAST_CLI_AGENT_MODEL": ""}):
        assert helper.current_model(settings) == "pi:custom/chosen"
        settings["providers"]["pi"]["defaultModel"] = "pi:custom/new-default"
        assert helper.current_model(settings) == "pi:custom/new-default"
    assert helper.environment_overrides("LITERAL=$(never-run)\nTOKEN='a=b'") == {"LITERAL": "$(never-run)", "TOKEN": "a=b"}
    with patch.dict(os.environ, {"SHELL": "/bin/sh"}):
        env = helper.local_env("pi", settings["providers"]["pi"])
    assert env["SCOPED"] == "pi=value"
    assert env["PI_CODING_AGENT_DIR"] == root
    assert helper.binary_for("codex", {"PATH": "/bin"}, settings["providers"]["codex"]) == "/bin/echo"
    settings["providers"]["pi"]["enabled"] = False
    with patch.object(helper.subprocess, "run", side_effect=AssertionError("Disabled provider must not launch")):
        answer, error = helper.ask("must not be sent", "pi:custom/chosen", settings)
        assert answer is None and "disabled" in error
    settings["providers"]["pi"]["enabled"] = True
    with patch.object(helper, "local_env", return_value={"PATH": "/bin"}), patch.object(helper, "binary_for", return_value="/fake/pi"), patch.object(helper.subprocess, "run", return_value=SimpleNamespace(returncode=0, stdout="ok", stderr="")) as run:
        answer, error = helper.ask("question", "pi:custom/chosen", settings)
        assert answer == "ok" and error is None
        args = run.call_args.args[0]
        assert args[args.index("--thinking") + 1] == "high"
        assert args[args.index("--provider") + 1] == "custom"
        assert "Use short answers." in args[args.index("--system-prompt") + 1]
`,
    ],
    {
      encoding: "utf8",
      timeout: 10_000,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    },
  );
  assert.equal(result.status, 0, result.stderr || result.error?.message);
});
