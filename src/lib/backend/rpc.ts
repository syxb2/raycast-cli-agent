import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, Interface } from "node:readline";

// Providers own their wire formats; this class owns JSONL and process lifecycle.
export type RecordValue = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class JsonLineProcess {
  readonly child: ChildProcessWithoutNullStreams;
  private lines: Interface;
  private sequence = 0;
  private pending = new Map<
    string | number,
    {
      resolve: (value: RecordValue) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private listeners = new Set<(record: RecordValue) => void>();
  private closeListeners = new Set<(error: Error) => void>();
  private failure?: Error;
  private stderr = "";

  constructor(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    private protocol: "codex" | "pi",
  ) {
    this.child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on("line", (line) => {
      let record: RecordValue;
      try {
        record = JSON.parse(line);
      } catch {
        return;
      }
      this.receive(record);
    });
    this.child.stderr.on("data", (data: Buffer) => {
      this.stderr = (this.stderr + data.toString()).slice(-8192);
    });
    this.child.once("error", (error) => this.closed(error));
    this.child.stdin.on("error", (error) => this.closed(error));
    this.child.once("close", () =>
      this.closed(
        new Error(this.stderr.trim() || `${protocol} process exited.`),
      ),
    );
  }

  get isClosed(): boolean {
    return Boolean(this.failure);
  }

  onRecord(listener: (record: RecordValue) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onClose(listener: (error: Error) => void): () => void {
    if (this.failure) listener(this.failure);
    else this.closeListeners.add(listener);
    return () => {
      this.closeListeners.delete(listener);
    };
  }

  request<T = RecordValue>(
    method: string,
    params: RecordValue = {},
    timeoutMs = 30_000,
  ): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out.`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.send(
        this.protocol === "codex"
          ? { id, method, params }
          : { id, type: method, ...params },
      );
    });
  }

  send(record: RecordValue): void {
    if (this.failure) return;
    this.child.stdin.write(`${JSON.stringify(record)}\n`, (error) => {
      if (error) this.closed(error);
    });
  }

  shutdown(): void {
    if (!this.failure) this.closed(new Error("CLI runtime stopped."));
    this.lines.close();
    this.child.stdin.end();
    this.child.kill("SIGTERM");
    const timer = setTimeout(() => {
      if (this.child.exitCode === null) this.child.kill("SIGKILL");
    }, 1500);
    timer.unref();
    this.child.once("close", () => clearTimeout(timer));
  }

  private receive(record: RecordValue): void {
    if (!record || typeof record !== "object") return;
    const response =
      this.protocol === "codex"
        ? !record.method && record.id !== undefined
        : record.type === "response";
    const pending = response ? this.pending.get(record.id) : undefined;
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(record.id);
      if (record.error || record.success === false) {
        pending.reject(
          new Error(
            typeof record.error === "string"
              ? record.error
              : record.error?.message || "CLI request failed.",
          ),
        );
      } else pending.resolve(record.result ?? record.data ?? {});
      return;
    }
    for (const listener of this.listeners) listener(record);
  }

  private closed(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    for (const listener of this.closeListeners) listener(error);
    this.closeListeners.clear();
    this.listeners.clear();
  }
}
