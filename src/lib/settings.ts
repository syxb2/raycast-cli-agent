import { environment, getPreferenceValues } from "@raycast/api";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  CLAUDE_DEFAULT,
  PROVIDERS,
  CODEX_DEFAULT,
  CODEX_PREFIX,
  PI_DEFAULT,
  Provider,
  isSupportedModel,
  piModelId,
  providerOf,
} from "./provider";

export type Effort =
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export const CODEX_EFFORTS: Effort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
export const PI_THINKING_LEVELS: Effort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface GeneralSettings {
  defaultProvider: Provider;
  primaryLanguage: string;
  secondaryLanguage: string;
  extraInstructions: string;
}

export interface ProviderSettings {
  enabled: boolean;
  cliPath: string;
  configDir: string;
  environmentVariables: string;
  defaultModel: string;
  customModels: string[];
  visibleModels: string[] | null;
  modelAliases: Record<string, string>;
  tools: boolean;
  allowAllTools: boolean;
}

export interface CodexSettings extends ProviderSettings {
  effort: Effort | "";
  webSearch: boolean;
  responseStyle: "default" | "friendly" | "pragmatic" | "none";
  responseVerbosity: "default" | "low" | "medium" | "high";
  reasoningSummary: "default" | "auto" | "concise" | "detailed" | "none";
}

export const CLAUDE_EFFORTS: Effort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface ClaudeSettings extends ProviderSettings {
  effort: Effort | "";
  webSearch: boolean;
}

export interface PiSettings extends ProviderSettings {
  thinkingLevel: Effort | "";
  preferredThinkingByModel: Record<string, Effort>;
}

export interface ProviderSettingsMap {
  codex: CodexSettings;
  pi: PiSettings;
  claude: ClaudeSettings;
}
export interface Settings {
  version: 1;
  general: GeneralSettings;
  providers: ProviderSettingsMap;
}

export function defaultSettings(): Settings {
  const common = (): ProviderSettings => ({
    enabled: true,
    cliPath: "",
    configDir: "",
    environmentVariables: "",
    defaultModel: "",
    customModels: [],
    visibleModels: null,
    modelAliases: {},
    tools: false,
    allowAllTools: false,
  });
  return {
    version: 1,
    general: {
      defaultProvider: "codex",
      primaryLanguage: "English",
      secondaryLanguage: "English",
      extraInstructions: "",
    },
    providers: {
      codex: {
        ...common(),
        defaultModel: CODEX_DEFAULT,
        effort: "",
        webSearch: false,
        responseStyle: "default",
        responseVerbosity: "default",
        reasoningSummary: "default",
      },
      claude: {
        ...common(),
        enabled: false,
        defaultModel: CLAUDE_DEFAULT,
        effort: "",
        webSearch: false,
      },
      pi: {
        ...common(),
        defaultModel: PI_DEFAULT,
        thinkingLevel: "",
        preferredThinkingByModel: {},
      },
    },
  };
}

function settingsFile(): string {
  mkdirSync(environment.supportPath, { recursive: true });
  return join(environment.supportPath, "settings.json");
}

function writeSettings(settings: Settings): void {
  const file = settingsFile();
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  renameSync(temp, file);
}

// Read old native preferences only once. The local nested document then owns
// all settings; native CLI files and imported credential files are never edited.
function importLegacySettings(): Settings {
  const settings = defaultSettings();
  let legacy: Record<string, unknown> = {};
  try {
    legacy = getPreferenceValues<Record<string, unknown>>();
  } catch {
    /* No native preferences. */
  }
  const text = (key: string) =>
    typeof legacy[key] === "string" ? (legacy[key] as string).trim() : "";
  let selected = text("model");
  const previousModelFile = join(environment.supportPath, "current-model");
  if (existsSync(previousModelFile)) {
    const previous = readFileSync(previousModelFile, "utf8").trim();
    if (isSupportedModel(previous)) selected = previous;
  }
  if (isSupportedModel(selected)) {
    const provider = providerOf(selected);
    settings.general.defaultProvider = provider;
    settings.providers[provider].defaultModel = selected;
  }
  for (const key of [
    "primaryLanguage",
    "secondaryLanguage",
    "extraInstructions",
  ] as const) {
    if (text(key)) settings.general[key] = text(key);
  }
  settings.providers.codex.cliPath = text("codexPath");
  settings.providers.codex.configDir = text("codexHome");
  settings.providers.pi.cliPath = text("piPath");
  settings.providers.pi.configDir = text("piAgentDir");
  settings.providers.codex.webSearch = legacy.webSearch === true;
  for (const provider of ["codex", "pi"] as const)
    settings.providers[provider].tools = legacy.chatTools === true;
  const effort = text("effort") as Effort;
  if (CODEX_EFFORTS.includes(effort)) settings.providers.codex.effort = effort;
  if (PI_THINKING_LEVELS.includes(effort))
    settings.providers.pi.thinkingLevel = effort;
  for (const raw of text("customModels")
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean)) {
    const model = isSupportedModel(raw) ? raw : `${CODEX_PREFIX}${raw}`;
    settings.providers[providerOf(model)].customModels.push(model);
  }
  writeSettings(settings);
  return settings;
}

export function getSettings(): Settings {
  const file = settingsFile();
  if (!existsSync(file)) return importLegacySettings();
  const stored = JSON.parse(readFileSync(file, "utf8"));
  if (stored.version !== 1) throw new Error("Unsupported settings version.");
  const defaults = defaultSettings();
  return {
    version: 1,
    general: { ...defaults.general, ...stored.general },
    providers: {
      codex: { ...defaults.providers.codex, ...stored.providers?.codex },
      pi: { ...defaults.providers.pi, ...stored.providers?.pi },
      claude: { ...defaults.providers.claude, ...stored.providers?.claude },
    },
  };
}

export function getProviderSettings<P extends Provider>(
  provider: P,
): ProviderSettingsMap[P] {
  return getSettings().providers[provider];
}

export function enabledProviders(): Provider[] {
  const settings = getSettings();
  return PROVIDERS.filter((provider) => settings.providers[provider].enabled);
}

export function parseEnvironmentVariables(
  text: string,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
      line,
    );
    if (!match)
      throw new Error(
        `Invalid environment variable on line ${index + 1}. Use KEY=value.`,
      );
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    // Values are passed as data. Never evaluate shell substitutions.
    values[match[1]] = value;
  }
  return values;
}

export function normalizeProviderModel(
  provider: Provider,
  model: string,
): string {
  const value = model.trim();
  const normalized = isSupportedModel(value) ? value : `${provider}:${value}`;
  if (!value || providerOf(normalized) !== provider)
    throw new Error(`Choose a ${provider} model for these settings.`);
  if (provider === "pi") piModelId(normalized);
  return normalized;
}

function validateSettings(settings: Settings): void {
  if (!PROVIDERS.some((provider) => settings.providers[provider].enabled))
    throw new Error("Keep at least one provider enabled.");
  if (!settings.providers[settings.general.defaultProvider]?.enabled) {
    settings.general.defaultProvider = PROVIDERS.find(
      (provider) => settings.providers[provider].enabled,
    )!;
  }
  for (const provider of PROVIDERS) {
    const value = settings.providers[provider];
    value.cliPath = value.cliPath.trim();
    value.configDir = value.configDir.trim();
    value.defaultModel = normalizeProviderModel(provider, value.defaultModel);
    value.customModels = [
      ...new Set(
        value.customModels.map((m) => normalizeProviderModel(provider, m)),
      ),
    ];
    if (value.visibleModels !== null)
      value.visibleModels = [
        ...new Set(
          value.visibleModels.map((m) => normalizeProviderModel(provider, m)),
        ),
      ];
    value.modelAliases = Object.fromEntries(
      Object.entries(value.modelAliases)
        .filter(([, alias]) => alias.trim())
        .map(([model, alias]) => [
          normalizeProviderModel(provider, model),
          alias.trim(),
        ]),
    );
    parseEnvironmentVariables(value.environmentVariables);
  }
  const codex = settings.providers.codex;
  if (codex.effort && !CODEX_EFFORTS.includes(codex.effort))
    throw new Error("Invalid Codex reasoning effort.");
  if (
    !["default", "friendly", "pragmatic", "none"].includes(codex.responseStyle)
  )
    throw new Error("Invalid Codex response style.");
  if (!["default", "low", "medium", "high"].includes(codex.responseVerbosity))
    throw new Error("Invalid Codex response verbosity.");
  if (
    !["default", "auto", "concise", "detailed", "none"].includes(
      codex.reasoningSummary,
    )
  )
    throw new Error("Invalid Codex reasoning summary.");
  const claude = settings.providers.claude;
  if (claude.effort && !CLAUDE_EFFORTS.includes(claude.effort))
    throw new Error("Invalid Claude reasoning effort.");
  const pi = settings.providers.pi;
  if (pi.thinkingLevel && !PI_THINKING_LEVELS.includes(pi.thinkingLevel))
    throw new Error("Invalid Pi thinking level.");
  pi.preferredThinkingByModel = Object.fromEntries(
    Object.entries(pi.preferredThinkingByModel).map(([model, level]) => {
      if (!PI_THINKING_LEVELS.includes(level))
        throw new Error("Invalid Pi model thinking level.");
      return [normalizeProviderModel("pi", model), level];
    }),
  );
}

export function updateGeneralSettings(updates: Partial<GeneralSettings>): void {
  const settings = getSettings();
  if (
    updates.defaultProvider &&
    !settings.providers[updates.defaultProvider].enabled
  )
    throw new Error("Enable the selected default provider first.");
  settings.general = { ...settings.general, ...updates };
  validateSettings(settings);
  writeSettings(settings);
}

export function updateProviderSettings<P extends Provider>(
  provider: P,
  updates: Partial<ProviderSettingsMap[P]>,
): void {
  const settings = getSettings();
  Object.assign(settings.providers[provider], updates);
  validateSettings(settings);
  writeSettings(settings);
}
