import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { refreshProviderCatalog } from "../lib/modelCatalog";
import {
  browserModels,
  modelLabel,
  sameModel,
  setVisibleModels,
} from "../lib/models";
import { Provider, PROVIDER_NAMES } from "../lib/provider";
import { getProviderSettings, updateProviderSettings } from "../lib/settings";

export function ModelBrowser({ provider }: { provider: Provider }) {
  const [models, setModels] = useState(() => browserModels(provider));
  const [selected, setSelected] = useState(
    () => getProviderSettings(provider).visibleModels ?? [],
  );
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reload = () => {
    setModels(browserModels(provider));
    setSelected(getProviderSettings(provider).visibleModels ?? []);
  };
  const refresh = async () => {
    setBusy(true);
    try {
      await refreshProviderCatalog(provider);
      setError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      await showToast({
        style: Toast.Style.Failure,
        title: "Model discovery failed",
        message,
      });
    } finally {
      reload();
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, [provider]);
  const vendorOf = (id: string) =>
    provider === "pi" ? id.slice(3).split("/")[0] : provider;
  const vendors = [...new Set(models.map((m) => vendorOf(m.value)))].sort();
  const filtered = models.filter(
    (m) => filter === "all" || vendorOf(m.value) === filter,
  );
  const visible = selected.flatMap((id) =>
    filtered.filter((m) => m.value === id),
  );
  const remaining = filtered.filter((m) => !selected.includes(m.value));
  const update = (ids: string[]) => {
    setVisibleModels(provider, ids);
    reload();
  };
  const move = (id: string, direction: number) => {
    const next = [...selected];
    const index = next.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  };
  return (
    <List
      navigationTitle={`${PROVIDER_NAMES[provider]} Model Browser`}
      searchBarPlaceholder="Search models"
      isLoading={busy}
      searchBarAccessory={
        <List.Dropdown
          tooltip="Model Provider"
          value={filter}
          onChange={setFilter}
        >
          <List.Dropdown.Item value="all" title="All Providers" />
          {vendors.map((vendor) => (
            <List.Dropdown.Item key={vendor} value={vendor} title={vendor} />
          ))}
        </List.Dropdown>
      }
      actions={
        <ActionPanel>
          <Action
            title="Refresh Models"
            icon={Icon.ArrowClockwise}
            onAction={refresh}
          />
        </ActionPanel>
      }
    >
      {!filtered.length ? (
        <List.EmptyView
          icon={Icon.MagnifyingGlass}
          title={busy ? "Checking Models…" : "No Models"}
          description={
            error ||
            "Configure authentication in the CLI, then refresh. Models come from the CLI; Pi also checks provider authentication."
          }
        />
      ) : null}
      {[
        { title: "Visible Models", models: visible },
        { title: "Model Browser", models: remaining },
      ].map((section) => (
        <List.Section
          key={section.title}
          title={section.title}
          subtitle={`${section.models.length}`}
        >
          {section.models.map((model) => {
            const checked = selected.includes(model.value);
            const isDefault = sameModel(
              model.value,
              getProviderSettings(provider).defaultModel,
            );
            return (
              <List.Item
                key={model.value}
                id={model.value}
                title={modelLabel(model.value)}
                subtitle={model.description}
                icon={checked ? Icon.Checkmark : Icon.Circle}
                keywords={[model.value, vendorOf(model.value)]}
                accessories={[
                  ...(isDefault ? [{ text: "Default" }] : []),
                  { text: vendorOf(model.value) },
                ]}
                actions={
                  <ActionPanel>
                    <Action
                      title={checked ? "Hide from Chat" : "Show in Chat"}
                      icon={checked ? Icon.MinusCircle : Icon.PlusCircle}
                      onAction={() =>
                        update(
                          checked
                            ? selected.filter((id) => id !== model.value)
                            : [...selected, model.value],
                        )
                      }
                    />
                    <Action
                      title="Set as Default Model"
                      icon={Icon.Star}
                      onAction={() => {
                        updateProviderSettings(provider, {
                          visibleModels: [
                            model.value,
                            ...selected.filter((id) => id !== model.value),
                          ],
                          defaultModel: model.value,
                        });
                        reload();
                      }}
                    />
                    {checked ? (
                      <>
                        <Action
                          title="Move up"
                          icon={Icon.ArrowUp}
                          shortcut={Keyboard.Shortcut.Common.MoveUp}
                          onAction={() => move(model.value, -1)}
                        />
                        <Action
                          title="Move Down"
                          icon={Icon.ArrowDown}
                          shortcut={Keyboard.Shortcut.Common.MoveDown}
                          onAction={() => move(model.value, 1)}
                        />
                      </>
                    ) : null}
                    <ActionPanel.Section>
                      <Action
                        title="Show Filtered Models in Chat"
                        onAction={() =>
                          update([
                            ...new Set([
                              ...selected,
                              ...filtered.map((m) => m.value),
                            ]),
                          ])
                        }
                      />
                      <Action
                        title="Clear Visible Models"
                        onAction={() => update([])}
                      />
                      <Action
                        title="Refresh Models"
                        icon={Icon.ArrowClockwise}
                        shortcut={Keyboard.Shortcut.Common.Refresh}
                        onAction={refresh}
                      />
                    </ActionPanel.Section>
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ))}
    </List>
  );
}
