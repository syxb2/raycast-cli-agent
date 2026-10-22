import { environment, LocalStorage } from "@raycast/api";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { RequestOptions } from "./options";
import { RateLimit } from "./types";
import {
  CODEX_DEFAULT,
  Provider,
  isSupportedModel,
  providerOf,
} from "./provider";
import { claimSessionProvider, deleteSessionBinding } from "./backend/sessions";

export interface Message {
  id: string;
  question: string;
  // Preserve the actual request when the displayed question is abbreviated.
  prompt?: string;
  systemPrompt?: string;
  answer: string;
  createdAt: number;
  error?: string;
  // Record the model used for this answer within the chat's fixed agent.
  model?: string;
  // Shell commands the model asked to run, until approved or dismissed.
  commands?: string[];
  steps?: string[];
  durationMs?: number;
}

export interface Conversation {
  id: string;
  readonly provider: Provider;
  // Stable local identity; the backend owns native thread/session bindings.
  sessionId: string;
  title: string;
  model: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  // Web search, effort and tools; can change mid-chat.
  options?: RequestOptions;
}

// Chat contents live in files; LocalStorage only keeps a small index because
// Raycast extensions have a 100 MB memory limit.
const INDEX_KEY = "conversation-index";

function dir(): string {
  const d = join(environment.supportPath, "conversations");
  mkdirSync(d, { recursive: true });
  return d;
}

export type ConversationSummary = Pick<
  Conversation,
  "id" | "title" | "provider" | "model" | "updatedAt"
>;

export async function listConversations(): Promise<ConversationSummary[]> {
  const raw = await LocalStorage.getItem<string>(INDEX_KEY);
  const index: ConversationSummary[] = raw ? JSON.parse(raw) : [];
  return index.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadConversation(id: string): Conversation | undefined {
  try {
    const conversation: Conversation = JSON.parse(
      readFileSync(join(dir(), `${id}.json`), "utf8"),
    );
    if (!isSupportedModel(conversation.model))
      conversation.model = CODEX_DEFAULT;
    const provider = conversation.provider ?? providerOf(conversation.model);
    if (provider !== providerOf(conversation.model)) return undefined;
    return { ...conversation, provider };
  } catch {
    return undefined;
  }
}

let indexWrite: Promise<void> = Promise.resolve();

function updateIndex(
  update: (index: ConversationSummary[]) => ConversationSummary[],
): Promise<void> {
  const operation = indexWrite
    .catch(() => {})
    .then(async () => {
      await LocalStorage.setItem(
        INDEX_KEY,
        JSON.stringify(update(await listConversations())),
      );
    });
  indexWrite = operation;
  return operation;
}

export async function saveConversation(c: Conversation): Promise<void> {
  if (providerOf(c.model) !== c.provider)
    throw new Error("A chat's model must belong to its bound agent.");
  const previous = loadConversation(c.id);
  if (previous && previous.provider !== c.provider)
    throw new Error("A chat's agent cannot be changed. Start a new chat.");
  claimSessionProvider(c.sessionId, c.provider);
  const file = join(dir(), `${c.id}.json`);
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(c), { mode: 0o600 });
  renameSync(temp, file);
  await updateIndex((items) => [
    ...items.filter((s) => s.id !== c.id),
    {
      id: c.id,
      title: c.title,
      provider: c.provider,
      model: c.model,
      updatedAt: c.updatedAt,
    },
  ]);
}

export async function deleteConversation(id: string): Promise<void> {
  const conversation = loadConversation(id);
  rmSync(join(dir(), `${id}.json`), { force: true });
  if (conversation) deleteSessionBinding(conversation.sessionId);
  await updateIndex((items) => items.filter((s) => s.id !== id));
}

export function newConversation(
  model: string,
  options?: RequestOptions,
): Conversation {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    provider: providerOf(model),
    sessionId: crypto.randomUUID(),
    title: "",
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
    options,
  };
}

export function titleFrom(question: string): string {
  const line = question.trim().split("\n")[0];
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
}

const RATE_KEY = "last-rate-limit";

export async function saveRateLimit(r: RateLimit | undefined): Promise<void> {
  if (r) await LocalStorage.setItem(RATE_KEY, JSON.stringify(r));
}

export async function loadRateLimit(): Promise<RateLimit | undefined> {
  const raw = await LocalStorage.getItem<string>(RATE_KEY);
  return raw ? JSON.parse(raw) : undefined;
}
