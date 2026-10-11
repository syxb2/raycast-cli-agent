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
import { modelLabel } from "../lib/format";
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
      title: "Sohbet silinsin mi?",
      message: c.title,
      primaryAction: { title: "Sil", style: Alert.ActionStyle.Destructive },
    });
    if (!ok) return;
    await deleteConversation(c.id);
    await reload();
  };

  return (
    <List isLoading={!items} searchBarPlaceholder="Sohbetlerde ara">
      <List.EmptyView icon={Icon.Clock} title="Henüz sohbet yok" />
      {items?.map((c) => (
        <List.Item
          key={c.id}
          title={c.title || "Adsız sohbet"}
          icon={Icon.Bubble}
          accessories={[
            { text: modelLabel(c.model) },
            { date: new Date(c.updatedAt) },
          ]}
          actions={
            <ActionPanel>
              <Action.Push
                title="Aç"
                icon={Icon.Bubble}
                target={<ConversationLoader id={c.id} />}
                onPop={reload}
              />
              <Action
                title="Sil"
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
  if (!conversation)
    return (
      <List>
        <List.EmptyView icon={Icon.Warning} title="Sohbet dosyası bulunamadı" />
      </List>
    );
  return <ChatView initial={conversation} />;
}
