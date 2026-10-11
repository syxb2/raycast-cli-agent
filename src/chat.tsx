import { LaunchProps } from "@raycast/api";
import { ChatView } from "./components/ChatView";

export default function Command(props: LaunchProps) {
  return <ChatView firstQuestion={props.fallbackText?.trim() || undefined} />;
}
