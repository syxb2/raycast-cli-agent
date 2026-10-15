import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Provider } from "../provider";
import { supportDirectory } from "./environment";

export interface NativeSession {
  id: string;
  file?: string;
  configDir: string;
}

interface SessionBinding {
  readonly provider: Provider;
  native?: NativeSession;
}

function bindingFile(sessionId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId))
    throw new Error("Invalid local session ID.");
  return join(supportDirectory("sessions", "bindings"), `${sessionId}.json`);
}

function readBinding(sessionId: string): SessionBinding | undefined {
  const file = bindingFile(sessionId);
  if (!existsSync(file)) return undefined;
  const saved = JSON.parse(readFileSync(file, "utf8"));
  if (saved.provider === "codex" || saved.provider === "pi") return saved;
  // Convert old single-agent records without retaining multi-agent bindings.
  const providers = (["codex", "pi"] as const).filter(
    (provider) => saved[provider],
  );
  if (providers.length !== 1)
    throw new Error(
      "This legacy chat has multiple or invalid agent bindings. Start a new chat.",
    );
  const provider = providers[0];
  return { provider, native: saved[provider] };
}

function legacyCodexId(sessionId: string): string | undefined {
  const file = join(supportDirectory("codex"), "threads.json");
  if (!existsSync(file)) return undefined;
  const id = JSON.parse(readFileSync(file, "utf8"))[sessionId];
  return typeof id === "string" ? id : undefined;
}

function existingBinding(sessionId: string): SessionBinding | undefined {
  return (
    readBinding(sessionId) ??
    (legacyCodexId(sessionId) ? { provider: "codex" } : undefined)
  );
}

function assertProvider(
  binding: SessionBinding | undefined,
  provider: Provider,
): void {
  if (binding && binding.provider !== provider)
    throw new Error(
      `This chat is bound to ${binding.provider}. Start a new chat to use ${provider}.`,
    );
}

function writeBinding(sessionId: string, binding: SessionBinding): void {
  const file = bindingFile(sessionId);
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(binding), { mode: 0o600 });
  renameSync(temp, file);
}

// Reserve the agent before launching a CLI, even if the first request fails.
export function claimSessionProvider(
  sessionId: string | undefined,
  provider: Provider,
): void {
  if (!sessionId) return;
  const binding = existingBinding(sessionId);
  assertProvider(binding, provider);
  writeBinding(sessionId, binding ?? { provider });
}

export function loadNativeSession(
  sessionId: string | undefined,
  provider: Provider,
  configDir: string,
): NativeSession | undefined {
  if (!sessionId) return undefined;
  const binding = existingBinding(sessionId);
  assertProvider(binding, provider);
  const legacy =
    provider === "codex" && !binding?.native
      ? legacyCodexId(sessionId)
      : undefined;
  const native =
    binding?.native ?? (legacy ? { id: legacy, configDir } : undefined);
  if (native && native.configDir !== configDir)
    throw new Error(
      "This chat belongs to a different CLI configuration directory. Restore that directory or start a new chat.",
    );
  return native;
}

export function saveNativeSession(
  sessionId: string | undefined,
  provider: Provider,
  native: NativeSession,
): void {
  if (!sessionId) return;
  assertProvider(existingBinding(sessionId), provider);
  writeBinding(sessionId, { provider, native });
}

export function deleteSessionBinding(sessionId: string): void {
  rmSync(bindingFile(sessionId), { force: true });
  const legacy = join(supportDirectory("codex"), "threads.json");
  if (existsSync(legacy)) {
    const threads = JSON.parse(readFileSync(legacy, "utf8"));
    if (sessionId in threads) {
      delete threads[sessionId];
      const temp = `${legacy}.${randomUUID()}.tmp`;
      writeFileSync(temp, JSON.stringify(threads), { mode: 0o600 });
      renameSync(temp, legacy);
    }
  }
}

const activeSessions = new Map<string, Promise<unknown>>();

export async function serializeSession<T>(
  sessionId: string | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (!sessionId) return run();
  const previous = activeSessions.get(sessionId);
  const current = (previous ?? Promise.resolve()).catch(() => {}).then(run);
  activeSessions.set(sessionId, current);
  try {
    return await current;
  } finally {
    if (activeSessions.get(sessionId) === current)
      activeSessions.delete(sessionId);
  }
}
