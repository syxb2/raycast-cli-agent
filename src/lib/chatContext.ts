import { providerOf } from "./provider";
import { Message } from "./storage";

// Each provider keeps its own session history. After switching provider
// mid-chat, the turns the other provider answered are missing there, so they
// are prepended to the next question. Older messages without a model were
// all answered by Claude.
export function withMissingContext(
  messages: Message[],
  model: string,
  question: string,
): string {
  const provider = providerOf(model);
  const answered = messages.filter((m) => m.answer && !m.error);
  const ownedBy = (m: Message) => providerOf(m.model ?? "haiku");
  const lastOwn = answered.map(ownedBy).lastIndexOf(provider);
  const missing = answered
    .slice(lastOwn + 1)
    .filter((m) => ownedBy(m) !== provider);
  if (!missing.length) return question;
  const transcript = missing
    .map((m) => `User: ${m.question}\n\nAssistant: ${m.answer}`)
    .join("\n\n");
  return `Earlier in this conversation (answered by another assistant, so not in your history):\n\n${transcript}\n\n---\n\n${question}`;
}
