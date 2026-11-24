import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";

// Providers own their wire formats; this class owns JSONL and process lifecycle.
export type RecordValue = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
  }
}

export class JsonLineProcess {
  readonly child: ChildProcessWithoutNullStreams;
  private stdoutBuffer = "";
  private sequence = 0;
  private pending = new Map<
    string | number,
    {
      resolve: (value: RecordValue) => void;
      reject: (error: Error) => void;
      timer?: NodeJS.Timeout;
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
    private protocol: "codex" | "pi" | "claude" | "antigravity",
  ) {
    this.child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    // Avoid readline splitting on U+2028/U+2029 inside JSON string payloads.
    this.child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
      let newline = this.stdoutBuffer.indexOf("\n");
      while (newline !== -1) {
        const line = this.stdoutBuffer.slice(0, newline).replace(/\r$/, "");
        this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
        if (line) {
          try {
            const record = JSON.parse(line);
            this.receive(record);
          } catch {
            // Ignore non-JSON lines emitted on stdout.
          }
        }
        newline = this.stdoutBuffer.indexOf("\n");
      }
    });
    this.child.stderr.on("data", (data: Buffer) => {
      this.stderr = (this.stderr + data.toString()).slice(-8192);
    });
    this.child.once("error", (error) => this.closed(error));
    this.child.stdin.on("error", (error) => this.closed(error));
    this.child.once("close", () => {
      const trailing = this.stdoutBuffer.replace(/\r$/, "").trim();
      this.stdoutBuffer = "";
      if (trailing) {
        try {
          this.receive(JSON.parse(trailing));
        } catch {
          // Ignore trailing partial/non-JSON text on close.
        }
      }
      this.closed(
        new Error(this.stderr.trim() || `${protocol} process exited.`),
      );
    });
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
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`${method} timed out.`));
            }, timeoutMs)
          : undefined;
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.send(
        this.protocol === "antigravity"
          ? { jsonrpc: "2.0", id, method, params }
          : this.protocol === "codex"
            ? { id, method, params }
            : this.protocol === "claude"
              ? {
                  type: "control_request",
                  request_id: String(id),
                  request: { subtype: method, ...params },
                }
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
    this.child.stdout.removeAllListeners("data");
    this.stdoutBuffer = "";
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
    if (this.protocol === "claude" && record.type === "control_response") {
      const response = record.response;
      const id = Number(response?.request_id);
      const pending = this.pending.get(id);
      if (pending) {
        if (pending.timer) clearTimeout(pending.timer);
        this.pending.delete(id);
        if (response.subtype === "error")
          pending.reject(
            new Error(response.error || "Claude control request failed."),
          );
        else pending.resolve(response.response ?? {});
      }
      return;
    }
    const response =
      this.protocol === "codex" || this.protocol === "antigravity"
        ? !record.method && record.id !== undefined
        : record.type === "response";
    const pending = response ? this.pending.get(record.id) : undefined;
    if (pending) {
      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(record.id);
      if (record.error || record.success === false) {
        pending.reject(
          new RpcError(
            typeof record.error === "string"
              ? record.error
              : record.error?.message || "CLI request failed.",
            typeof record.error?.code === "number"
              ? record.error.code
              : undefined,
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
      if (request.timer) clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    for (const listener of this.closeListeners) listener(error);
    this.closeListeners.clear();
    this.listeners.clear();
  }
}
