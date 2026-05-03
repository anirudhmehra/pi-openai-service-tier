import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  clampThinkingLevel,
  streamOpenAICodexResponses,
  streamOpenAIResponses,
  type Api,
  type Context,
  type Model,
  type ModelThinkingLevel,
  type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const COMMAND_FAST = "fast";
const COMMAND_TIER = "openai-tier";
const FLAG_FAST = "fast";
const STATUS_KEY = "pi-openai-service-tier";
const CONFIG_BASENAME = "pi-openai-service-tier.json";

export const SERVICE_TIERS = ["priority", "flex", "default", "auto"] as const;
export type ServiceTier = (typeof SERVICE_TIERS)[number];

export const DEFAULT_SUPPORTED_MODELS = [
  "openai/gpt-5.4",
  "openai/gpt-5.5",
  "openai-codex/gpt-5.4",
  "openai-codex/gpt-5.5",
] as const;

export interface SupportedModel {
  provider: string;
  id: string;
}

export interface ConfigFile {
  persistState?: boolean;
  active?: boolean;
  serviceTier?: ServiceTier;
  supportedModels?: string[];
}

export interface ResolvedConfig {
  configPath: string;
  persistState: boolean;
  active: boolean;
  serviceTier: ServiceTier;
  supportedModels: SupportedModel[];
}

interface RuntimeState {
  active: boolean;
  serviceTier: ServiceTier;
}

type OpenAIServiceTierOptions = SimpleStreamOptions & {
  serviceTier?: ServiceTier;
  reasoningEffort?: ModelThinkingLevel | "none";
};

const DEFAULT_CONFIG: Required<ConfigFile> = {
  persistState: true,
  active: false,
  serviceTier: "priority",
  supportedModels: [...DEFAULT_SUPPORTED_MODELS],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isServiceTier(value: unknown): value is ServiceTier {
  return typeof value === "string" && (SERVICE_TIERS as readonly string[]).includes(value);
}

export function parseModelKey(value: string): SupportedModel | undefined {
  const trimmed = value.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash >= trimmed.length - 1) return undefined;
  const provider = trimmed.slice(0, slash).trim();
  const id = trimmed.slice(slash + 1).trim();
  return provider && id ? { provider, id } : undefined;
}

export function normalizeModelKeys(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => parseModelKey(entry))
    .filter((entry): entry is SupportedModel => entry !== undefined)
    .map((entry) => `${entry.provider}/${entry.id}`);
}

export function parseModels(value: unknown): SupportedModel[] | undefined {
  const keys = normalizeModelKeys(value);
  if (keys === undefined) return undefined;
  return keys
    .map((key) => parseModelKey(key))
    .filter((entry): entry is SupportedModel => entry !== undefined);
}

export function configPaths(cwd: string, home = homedir()): { project: string; global: string } {
  return {
    project: join(cwd, ".pi", "extensions", CONFIG_BASENAME),
    global: join(home, ".pi", "agent", "extensions", CONFIG_BASENAME),
  };
}

export function readConfig(path: string): ConfigFile | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!isRecord(parsed)) return {};
    const config: ConfigFile = {};
    if (typeof parsed.persistState === "boolean") config.persistState = parsed.persistState;
    if (typeof parsed.active === "boolean") config.active = parsed.active;
    if (isServiceTier(parsed.serviceTier)) config.serviceTier = parsed.serviceTier;
    const supportedModels = normalizeModelKeys(parsed.supportedModels);
    if (supportedModels !== undefined) config.supportedModels = supportedModels;
    return config;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-openai-service-tier] Failed to read ${path}: ${message}`);
    return undefined;
  }
}

export function writeConfig(path: string, config: ConfigFile): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pi-openai-service-tier] Failed to write ${path}: ${message}`);
  }
}

function ensureConfigFile(projectPath: string, globalPath: string): void {
  if (existsSync(projectPath) || existsSync(globalPath)) return;
  writeConfig(globalPath, DEFAULT_CONFIG);
}

function defaultResolvedConfig(cwd: string, home = homedir()): ResolvedConfig {
  const paths = configPaths(cwd, home);
  return {
    configPath: paths.global,
    persistState: DEFAULT_CONFIG.persistState,
    active: DEFAULT_CONFIG.active,
    serviceTier: DEFAULT_CONFIG.serviceTier,
    supportedModels: parseModels(DEFAULT_SUPPORTED_MODELS) ?? [],
  };
}

export function resolveConfig(cwd: string, home = homedir()): ResolvedConfig {
  const paths = configPaths(cwd, home);
  ensureConfigFile(paths.project, paths.global);

  const projectExists = existsSync(paths.project);
  const globalConfig = readConfig(paths.global) ?? {};
  const projectConfig = readConfig(paths.project) ?? {};
  const merged: ConfigFile = { ...DEFAULT_CONFIG, ...globalConfig, ...projectConfig };

  return {
    configPath: projectExists ? paths.project : paths.global,
    persistState: merged.persistState ?? DEFAULT_CONFIG.persistState,
    active: merged.active ?? DEFAULT_CONFIG.active,
    serviceTier: merged.serviceTier ?? DEFAULT_CONFIG.serviceTier,
    supportedModels: parseModels(merged.supportedModels) ?? parseModels(DEFAULT_SUPPORTED_MODELS) ?? [],
  };
}

export function supportsServiceTier(
  model: Pick<Model<Api>, "provider" | "id" | "api"> | undefined,
  supportedModels: readonly SupportedModel[],
): boolean {
  if (!model) return false;
  if (model.api !== "openai-responses" && model.api !== "openai-codex-responses") return false;
  return supportedModels.some((supported) => supported.provider === model.provider && supported.id === model.id);
}

export function resolveServiceTierForModel(
  model: Pick<Model<Api>, "provider" | "id" | "api"> | undefined,
  state: RuntimeState,
  supportedModels: readonly SupportedModel[],
): ServiceTier | undefined {
  if (!state.active || !supportsServiceTier(model, supportedModels)) return undefined;
  return state.serviceTier;
}

function modelKey(model: Pick<Model<Api>, "provider" | "id"> | undefined): string {
  return model ? `${model.provider}/${model.id}` : "none";
}

function supportedModelList(models: readonly SupportedModel[]): string {
  return models.length ? models.map((model) => `${model.provider}/${model.id}`).join(", ") : "none";
}

function getConfigCwd(ctx: ExtensionContext): string {
  return ctx.cwd || process.cwd();
}

function buildFullOpenAIOptions(
  model: Model<Api>,
  options: SimpleStreamOptions | undefined,
  serviceTier: ServiceTier | undefined,
): OpenAIServiceTierOptions {
  const clampedReasoning = options?.reasoning ? clampThinkingLevel(model, options.reasoning) : undefined;
  const reasoningEffort = clampedReasoning === "off" ? undefined : clampedReasoning;
  return {
    ...options,
    maxTokens: options?.maxTokens ?? (model.maxTokens > 0 ? Math.min(model.maxTokens, 32_000) : undefined),
    reasoningEffort,
    ...(serviceTier ? { serviceTier } : {}),
  };
}

function statusText(ctx: ExtensionContext, state: RuntimeState, config: ResolvedConfig): string {
  const serviceTier = resolveServiceTierForModel(ctx.model, state, config.supportedModels);
  if (serviceTier) return `${ctx.model?.id ?? "model"} ${serviceTier}`;
  if (state.active) return `tier requested; unsupported ${modelKey(ctx.model)}`;
  return "";
}

export default function openAIServiceTier(pi: ExtensionAPI): void {
  let config: ResolvedConfig = defaultResolvedConfig(process.cwd());
  let state: RuntimeState = {
    active: config.active,
    serviceTier: config.serviceTier,
  };

  function refreshConfig(ctx: ExtensionContext): ResolvedConfig {
    config = resolveConfig(getConfigCwd(ctx));
    state = { active: config.active, serviceTier: config.serviceTier };
    return config;
  }

  function persistState(nextConfig: ResolvedConfig): void {
    if (!nextConfig.persistState) return;
    writeConfig(nextConfig.configPath, {
      ...(readConfig(nextConfig.configPath) ?? {}),
      active: state.active,
      serviceTier: state.serviceTier,
      supportedModels: nextConfig.supportedModels.map((model) => `${model.provider}/${model.id}`),
    });
  }

  function updateStatus(ctx: ExtensionContext): void {
    ctx.ui.setStatus(STATUS_KEY, statusText(ctx, state, config) || undefined);
  }

  function notifyStatus(ctx: ExtensionContext): void {
    const tier = resolveServiceTierForModel(ctx.model, state, config.supportedModels);
    if (tier) {
      ctx.ui.notify(`OpenAI service tier: ${tier} for ${modelKey(ctx.model)}. Cost accounting uses Pi's serviceTier option.`, "info");
      return;
    }
    if (state.active) {
      ctx.ui.notify(
        `OpenAI service tier ${state.serviceTier} is on, but ${modelKey(ctx.model)} is unsupported. Supported models: ${supportedModelList(config.supportedModels)}.`,
        "warning",
      );
      return;
    }
    ctx.ui.notify(`OpenAI service tier is off. Current model: ${modelKey(ctx.model)}.`, "info");
  }

  function setActive(ctx: ExtensionContext, active: boolean): void {
    refreshConfig(ctx);
    state.active = active;
    persistState(config);
    updateStatus(ctx);
    notifyStatus(ctx);
  }

  function setTier(ctx: ExtensionContext, serviceTier: ServiceTier): void {
    refreshConfig(ctx);
    state = { active: true, serviceTier };
    writeConfig(config.configPath, {
      ...(readConfig(config.configPath) ?? {}),
      ...(config.persistState ? { active: true } : {}),
      serviceTier,
      supportedModels: config.supportedModels.map((model) => `${model.provider}/${model.id}`),
    });
    config = { ...config, active: state.active, serviceTier };
    updateStatus(ctx);
    notifyStatus(ctx);
  }

  pi.registerFlag(FLAG_FAST, {
    description: "Start with OpenAI priority service tier enabled",
    type: "boolean",
    default: false,
  });

  pi.registerProvider("pi-openai-service-tier:openai-responses", {
    api: "openai-responses",
    streamSimple(model, context: Context, options?: SimpleStreamOptions) {
      const serviceTier = resolveServiceTierForModel(model, state, config.supportedModels);
      return streamOpenAIResponses(
        model as Model<"openai-responses">,
        context,
        buildFullOpenAIOptions(model, options, serviceTier) as never,
      );
    },
  });

  pi.registerProvider("pi-openai-service-tier:openai-codex-responses", {
    api: "openai-codex-responses",
    streamSimple(model, context: Context, options?: SimpleStreamOptions) {
      const serviceTier = resolveServiceTierForModel(model, state, config.supportedModels);
      return streamOpenAICodexResponses(
        model as Model<"openai-codex-responses">,
        context,
        buildFullOpenAIOptions(model, options, serviceTier) as never,
      );
    },
  });

  pi.registerCommand(COMMAND_FAST, {
    description: "Toggle cost-correct OpenAI priority service tier",
    getArgumentCompletions: (prefix) => {
      const values = ["on", "off", "status"];
      const items = values.filter((value) => value.startsWith(prefix.trim().toLowerCase()));
      return items.length ? items.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (!arg) return setActive(ctx, !state.active);
      if (arg === "on") return setActive(ctx, true);
      if (arg === "off") return setActive(ctx, false);
      if (arg === "status") {
        refreshConfig(ctx);
        updateStatus(ctx);
        return notifyStatus(ctx);
      }
      ctx.ui.notify("Usage: /fast [on|off|status]", "error");
    },
  });

  pi.registerCommand(COMMAND_TIER, {
    description: "Set OpenAI service tier (priority, flex, default, auto, off, status)",
    getArgumentCompletions: (prefix) => {
      const values = [...SERVICE_TIERS, "off", "status"];
      const items = values.filter((value) => value.startsWith(prefix.trim().toLowerCase()));
      return items.length ? items.map((value) => ({ value, label: value })) : null;
    },
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();
      if (!arg || arg === "status") {
        refreshConfig(ctx);
        updateStatus(ctx);
        return notifyStatus(ctx);
      }
      if (arg === "off") return setActive(ctx, false);
      if (isServiceTier(arg)) return setTier(ctx, arg);
      ctx.ui.notify("Usage: /openai-tier [priority|flex|default|auto|off|status]", "error");
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    refreshConfig(ctx);
    if (pi.getFlag(FLAG_FAST) === true) {
      state.active = true;
      state.serviceTier = "priority";
      persistState(config);
    }
    updateStatus(ctx);
    if (state.active) notifyStatus(ctx);
  });

  pi.on("model_select", async (_event, ctx) => {
    updateStatus(ctx);
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus(STATUS_KEY, undefined);
  });
}

export const _test = {
  CONFIG_BASENAME,
  DEFAULT_CONFIG,
  COMMAND_FAST,
  COMMAND_TIER,
  FLAG_FAST,
  STATUS_KEY,
  buildFullOpenAIOptions,
  modelKey,
  statusText,
};
