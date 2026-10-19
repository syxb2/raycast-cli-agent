import { environment } from "@raycast/api";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, mkdirSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { Provider } from "../provider";
import {
  getProviderSettings,
  parseEnvironmentVariables,
  ProviderSettings,
} from "../settings";

let shellEnvironment: Promise<NodeJS.ProcessEnv> | undefined;
let resolvedEnvironment: NodeJS.ProcessEnv | undefined;

export function cachedEnvironment(): NodeJS.ProcessEnv {
  return resolvedEnvironment ?? process.env;
}

export function providerFingerprint(
  provider: Provider,
  settings: ProviderSettings = getProviderSettings(provider),
): string {
  const env = providerEnvironment(provider, cachedEnvironment(), settings);
  const binary = resolveBinary(provider, env, settings);
  return binary
    ? runtimeFingerprint(provider, binary, env, settings)
    : `${provider}:missing`;
}

// GUI processes miss shell-exported provider keys, proxy variables and PATH.
// Values stay in memory and are never logged or copied into extension storage.
export function loadEnvironment(): Promise<NodeJS.ProcessEnv> {
  shellEnvironment ??= new Promise((resolveEnv) => {
    const child = spawn(
      process.env.SHELL || "/bin/zsh",
      ["-ilc", "/usr/bin/env -0"],
      {
        stdio: ["ignore", "pipe", "ignore"],
        env: process.env,
      },
    );
    let output = "";
    let finished = false;
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const fromShell: NodeJS.ProcessEnv = {};
      for (const entry of output.split("\0")) {
        const equal = entry.indexOf("=");
        const key = entry.slice(0, equal);
        if (equal > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
          fromShell[key] = entry.slice(equal + 1);
      }
      const env = { ...fromShell, ...process.env };
      env.USER ??= userInfo().username;
      env.LOGNAME ??= env.USER;
      env.PATH = [
        ...new Set(
          [
            ...(fromShell.PATH || "").split(delimiter),
            ...(env.PATH || "").split(delimiter),
            "/opt/homebrew/bin",
            "/usr/local/bin",
            join(homedir(), ".local/bin"),
            "/usr/bin",
            "/bin",
          ].filter(Boolean),
        ),
      ].join(delimiter);
      resolvedEnvironment = env;
      resolveEnv(env);
    };
    child.once("error", finish);
    child.once("close", finish);
  });
  return shellEnvironment;
}

export function expandPath(path: string): string {
  return resolve(path.replace(/^~(?=\/|$)/, homedir()));
}

export function configDirectory(
  provider: Provider,
  env: NodeJS.ProcessEnv = process.env,
  settings: ProviderSettings = getProviderSettings(provider),
): string {
  const value =
    provider === "codex"
      ? settings.configDir || env.CODEX_HOME || join(homedir(), ".codex")
      : provider === "claude"
        ? settings.configDir ||
          env.CLAUDE_CONFIG_DIR ||
          join(homedir(), ".claude")
        : settings.configDir ||
          env.PI_CODING_AGENT_DIR ||
          join(homedir(), ".pi/agent");
  return expandPath(value);
}

export function providerEnvironment(
  provider: Provider,
  base: NodeJS.ProcessEnv,
  settings: ProviderSettings = getProviderSettings(provider),
): NodeJS.ProcessEnv {
  const env = {
    ...base,
    ...parseEnvironmentVariables(settings.environmentVariables),
  };
  return {
    ...env,
    [provider === "codex"
      ? "CODEX_HOME"
      : provider === "claude"
        ? "CLAUDE_CONFIG_DIR"
        : "PI_CODING_AGENT_DIR"]: configDirectory(provider, env, settings),
  };
}

export function resolveBinary(
  provider: Provider,
  env: NodeJS.ProcessEnv = process.env,
  settings: ProviderSettings = getProviderSettings(provider),
): string | undefined {
  const custom = settings.cliPath;
  const paths = custom
    ? [expandPath(custom)]
    : [
        ...(env.PATH || "")
          .split(delimiter)
          .filter(Boolean)
          .map((dir) => join(dir, provider)),
        `/opt/homebrew/bin/${provider}`,
        `/usr/local/bin/${provider}`,
        ...[".local/bin", ".npm-global/bin", ".bun/bin"].map((dir) =>
          join(homedir(), dir, provider),
        ),
        ...(provider === "codex"
          ? [
              "/Applications/Codex.app/Contents/Resources/codex",
              "/Applications/ChatGPT.app/Contents/Resources/codex",
            ]
          : []),
      ];
  return paths.find((path) => {
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  });
}

export function supportDirectory(...parts: string[]): string {
  const dir = join(environment.supportPath, ...parts);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fileStamp(path: string): string {
  try {
    const s = statSync(path);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return "missing";
  }
}

// A changed config creates a fresh runtime; native session identities survive.
export function runtimeFingerprint(
  provider: Provider,
  binary: string,
  env: NodeJS.ProcessEnv,
  settings: ProviderSettings = getProviderSettings(provider),
): string {
  const dir = configDirectory(provider, env, settings);
  const files =
    provider === "codex"
      ? ["config.toml", "auth.json"]
      : provider === "claude"
        ? ["settings.json", ".credentials.json", ".claude.json"]
        : ["settings.json", "models.json", "auth.json"];
  return createHash("sha256")
    .update(
      JSON.stringify([
        binary,
        fileStamp(binary),
        dir,
        ...files.map((file) => fileStamp(join(dir, file))),
        Object.entries(env).sort(([a], [b]) => a.localeCompare(b)),
      ]),
    )
    .digest("hex");
}
