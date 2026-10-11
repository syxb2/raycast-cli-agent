import {
  Action,
  ActionPanel,
  Alert,
  confirmAlert,
  Icon,
  Keyboard,
  List,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { modelLabel } from "../lib/models";
import {
  ConversationSummary,
  deleteConversation,
  listConversations,
  loadConversation,
} from "../lib/storage";
import { ChatView } from "./ChatView";

export function HistoryView() {
  const [items, setItems] = useState<ConversationSummary[]>();

  const reload = () => listConversations().then(setItems);
  useEffect(() => {
    reload();
  }, []);

  const remove = async (c: ConversationSummary) => {
    const ok = await confirmAlert({
      title: "Delete Chat?",
      message: c.title,
      primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
    });
    if (!ok) return;
    await deleteConversation(c.id);
    await reload();
  };

  return (
    <List isLoading={!items} searchBarPlaceholder="Search chats">
      <List.EmptyView icon={Icon.Clock} title="No Chats Yet" />
      {items?.map((c) => (
        <List.Item
          key={c.id}
          title={c.title || "Untitled Chat"}
          icon={Icon.Bubble}
          accessories={[
            { text: modelLabel(c.model) },
            { date: new Date(c.updatedAt) },
          ]}
          actions={
            <ActionPanel>
              <Action.Push
                title="Open Chat"
                icon={Icon.Bubble}
                target={<ConversationLoader id={c.id} />}
                onPop={reload}
              />
              <Action
                title="Delete Chat"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                shortcut={Keyboard.Shortcut.Common.Remove}
                onAction={() => remove(c)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function ConversationLoader({ id }: { id: string }) {
  const conversation = loadConversation(id);
  if (!conversation) {
    return (
      <List>
        <List.EmptyView icon={Icon.Warning} title="Chat File Not Found" />
      </List>
    );
  }
  return <ChatView initial={conversation} />;
}
