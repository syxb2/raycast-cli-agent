import { LaunchProps } from "@raycast/api";
import { AnswerView } from "./components/AnswerView";
import { ChatView } from "./components/ChatView";

// Fallback komutu olarak eklenirse ana aramaya yazilan metin fallbackText ile gelir.
export default function Command(
  props: LaunchProps<{ arguments: Arguments.Ask }>,
) {
  const prompt = (props.arguments.prompt || props.fallbackText || "").trim();
  if (!prompt) return <ChatView />;
  return <AnswerView prompt={prompt} question={prompt} />;
}
