import { LaunchProps } from "@raycast/api";
import { AnswerView } from "./components/AnswerView";
import { ChatView } from "./components/ChatView";

// As a fallback command, the text typed in root search arrives as fallbackText.
export default function Command(
  props: LaunchProps<{ arguments: Arguments.Ask }>,
) {
  const prompt = (props.arguments.prompt || props.fallbackText || "").trim();
  if (!prompt) return <ChatView />;
  return <AnswerView prompt={prompt} question={prompt} />;
}
