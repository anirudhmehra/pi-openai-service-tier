import test, { type TestContext } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext, ProviderConfig } from "@earendil-works/pi-coding-agent";
import { normalizeContext, type Api, type Model } from "@earendil-works/pi-ai";
import { zstdDecompressSync } from "node:zlib";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import openAIServiceTier, {
  DEFAULT_SUPPORTED_MODELS,
  type ConfigFile,
  _test,
  configPaths,
  isServiceTier,
  parseModelKey,
  parseModels,
  readConfig,
  resolveConfig,
  resolveServiceTierForModel,
  supportedServiceTiersForModel,
  supportsConfiguredServiceTier,
  supportsServiceTier,
  type ServiceTier,
} from "./index.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "pi-openai-service-tier-"));
}

const openAIModel: Model<"openai-responses"> = {
  provider: "openai",
  name: "GPT-5.5",
  baseUrl: "https://example.invalid/v1",
  input: ["text"],
  contextWindow: 272000,
  cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  id: "gpt-5.5",
  api: "openai-responses",
  maxTokens: 128000,
  reasoning: true,
  thinkingLevelMap: { high: "high" },
};

const codexModel: Model<"openai-codex-responses"> = {
  ...openAIModel,
  provider: "openai-codex",
  api: "openai-codex-responses",
};

test("recognizes supported service tiers", () => {
  assert.equal(isServiceTier("priority"), true);
  assert.equal(isServiceTier("flex"), true);
  assert.equal(isServiceTier("default"), true);
  assert.equal(isServiceTier("auto"), true);
  assert.equal(isServiceTier("scale"), true);
  assert.equal(isServiceTier("fast"), false);
});

test("parses provider/model keys", () => {
  assert.deepEqual(parseModelKey("openai/gpt-5.5"), { provider: "openai", id: "gpt-5.5" });
  assert.equal(parseModelKey("openai"), undefined);
  assert.deepEqual(parseModels(["openai/gpt-5.5", "bad", 123]), [{ provider: "openai", id: "gpt-5.5" }]);
});

test("resolves project config over global config", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.global), { recursive: true });
    mkdirSync(dirname(paths.project), { recursive: true });
    writeFileSync(paths.global, JSON.stringify({ active: false, serviceTier: "flex" }), "utf8");
    writeFileSync(paths.project, JSON.stringify({ active: true, serviceTier: "priority" }), "utf8");

    const config = resolveConfig(cwd, home);
    assert.equal(config.configPath, paths.project);
    assert.equal(config.active, true);
    assert.equal(config.serviceTier, "priority");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("ignores malformed config and invalid service tiers", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    mkdirSync(dirname(paths.global), { recursive: true });
    writeFileSync(paths.global, "{ bad json", "utf8");
    assert.equal(readConfig(paths.global), undefined);

    writeFileSync(paths.global, JSON.stringify({ active: true, serviceTier: "turbo" }), "utf8");
    const config = resolveConfig(cwd, home);
    assert.equal(config.active, true);
    assert.equal(config.serviceTier, "priority");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("knows provider-specific service tier support", () => {
  assert.deepEqual([...supportedServiceTiersForModel(openAIModel)], ["priority", "flex", "default", "auto", "scale"]);
  assert.deepEqual([...supportedServiceTiersForModel(codexModel)], ["priority"]);
});

test("applies configured tier only when active, allow-listed, and tier-supported", () => {
  const supportedModels = parseModels(DEFAULT_SUPPORTED_MODELS) ?? [];
  assert.equal(supportsServiceTier(openAIModel, supportedModels), true);
  assert.equal(supportsServiceTier(codexModel, supportedModels), true);
  assert.equal(
    resolveServiceTierForModel(openAIModel, { active: true, serviceTier: "priority" satisfies ServiceTier }, supportedModels),
    "priority",
  );
  assert.equal(
    resolveServiceTierForModel(openAIModel, { active: false, serviceTier: "priority" }, supportedModels),
    undefined,
  );
  assert.equal(
    supportsConfiguredServiceTier(codexModel, { active: true, serviceTier: "flex" }, supportedModels),
    false,
  );
  assert.equal(
    resolveServiceTierForModel(codexModel, { active: true, serviceTier: "flex" }, supportedModels),
    undefined,
  );
  assert.equal(
    resolveServiceTierForModel(
      { provider: "openai", id: "gpt-4.1", api: "openai-responses" } as never,
      { active: true, serviceTier: "priority" },
      supportedModels,
    ),
    undefined,
  );
  assert.equal(
    resolveServiceTierForModel(
      { provider: "openai", id: "gpt-5.5", api: "openai-completions" } as never,
      { active: true, serviceTier: "priority" },
      supportedModels,
    ),
    undefined,
  );
});

test("full provider options include serviceTier for Pi cost accounting", () => {
  const options = _test.buildFullOpenAIOptions(openAIModel, { reasoning: "high" }, "priority");
  assert.equal(options.serviceTier, "priority");
  assert.equal(options.maxTokens, 32000);
  assert.equal(options.reasoningEffort, "high");
});

async function extensionFixture(t: TestContext, config: ConfigFile = {}, model: Model<Api> = openAIModel) {
  const cwd = tempDir();
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const paths = configPaths(cwd);
  mkdirSync(dirname(paths.project), { recursive: true });
  writeFileSync(paths.project, JSON.stringify({
    active: false,
    serviceTier: "priority",
    supportedModels: ["openai/gpt-6.1-sol", "openai-codex/gpt-6.1-sol", ...DEFAULT_SUPPORTED_MODELS],
    ...config,
  }));
  const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
  const providers = new Map<string, ProviderConfig>();
  const handlers = new Map<string, (event: never, ctx: ExtensionCommandContext) => unknown>();
  const notifications: string[] = [];
  const statuses = new Map<string, string | undefined>();
  const ctx = {
    cwd,
    model,
    ui: {
      setStatus(key: string, value: string | undefined) { statuses.set(key, value); },
      notify(message: string) { notifications.push(message); },
    },
  } as unknown as ExtensionCommandContext;
  const api = {
    registerCommand(name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) { commands.set(name, command); },
    registerProvider(name: string, provider: ProviderConfig) { providers.set(name, provider); },
    registerFlag() {},
    getFlag() { return false; },
    on(name: string, handler: (event: never, ctx: ExtensionCommandContext) => unknown) { handlers.set(name, handler); },
  } as unknown as ExtensionAPI;
  openAIServiceTier(api);
  await handlers.get("session_start")?.({} as never, ctx);
  return { commands, providers, notifications, statuses, ctx, paths };
}

const solModel: Model<"openai-responses"> = {
  ...openAIModel,
  provider: "openai",
  id: "gpt-6.1-sol",
  api: "openai-responses",
  baseUrl: "https://example.invalid/v1",
  input: ["text"],
  contextWindow: 272000,
  cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
};

async function capturePayload(fixture: Awaited<ReturnType<typeof extensionFixture>>) {
  let payload: Record<string, unknown> | undefined;
  const provider = fixture.providers.get(fixture.ctx.model!.provider)!;
  const result = await provider.streamSimple!(fixture.ctx.model!, normalizeContext({ messages: [] }), {
    apiKey: "test-api-key",
    onPayload(value) {
      payload = value as Record<string, unknown>;
      throw new Error("captured without sending");
    },
  }).result();
  assert.match(result.errorMessage ?? "", /captured without sending/);
  return payload!;
}

test("Ultrafast is supported only for eligible models on both APIs", () => {
  assert.equal(isServiceTier("ultrafast"), true);
  const models = parseModels([
    "openai/gpt-6-astra", "openai/gpt-6.1-sol", "openai-codex/gpt-6-astra", "openai-codex/gpt-6.1-sol",
    "openai/gpt-5.5", "openai-codex/gpt-5.5",
  ])!;
  for (const provider of ["openai", "openai-codex"]) {
    const api = provider === "openai" ? "openai-responses" : "openai-codex-responses";
    for (const id of ["gpt-6-astra", "gpt-6.1-sol", "gpt-5.5"]) {
      assert.equal(
        resolveServiceTierForModel({ provider, id, api } as never, { active: true, serviceTier: "ultrafast" as ServiceTier }, models),
        id === "gpt-5.5" ? undefined : "ultrafast",
      );
    }
  }
});

test("newer OpenAI and Codex models are enabled by default", () => {
  for (const provider of ["openai", "openai-codex"]) {
    for (const id of ["gpt-6-astra", "gpt-6.1-sol"]) {
      assert.ok((DEFAULT_SUPPORTED_MODELS as readonly string[]).includes(`${provider}/${id}`));
    }
  }
});

test("/fast on replaces a previously configured Flex tier with Priority", async (t) => {
  const fixture = await extensionFixture(t, { serviceTier: "flex" }, solModel);
  await fixture.commands.get("fast")!.handler("on", fixture.ctx);
  assert.equal((await capturePayload(fixture)).service_tier, "priority");
});

test("non-persistent fast mode survives status checks", async (t) => {
  const fixture = await extensionFixture(t, { persistState: false }, solModel);
  await fixture.commands.get("fast")!.handler("on", fixture.ctx);
  await fixture.commands.get("fast")!.handler("status", fixture.ctx);
  assert.equal((await capturePayload(fixture)).service_tier, "priority");
  assert.equal(readConfig(fixture.paths.project)?.active, false);
});

test("/ultrafast switches modes, persists its tier, and toggles off", async (t) => {
  const fixture = await extensionFixture(t, { active: true }, solModel);
  assert.ok(fixture.commands.has("ultrafast"));
  await fixture.commands.get("ultrafast")!.handler("", fixture.ctx);
  assert.equal((await capturePayload(fixture)).service_tier, "ultrafast");
  assert.equal(readConfig(fixture.paths.project)?.serviceTier, "ultrafast");
  await fixture.commands.get("fast")!.handler("", fixture.ctx);
  assert.equal((await capturePayload(fixture)).service_tier, "priority");
  await fixture.commands.get("ultrafast")!.handler("on", fixture.ctx);
  await fixture.commands.get("ultrafast")!.handler("", fixture.ctx);
  assert.equal((await capturePayload(fixture)).service_tier, undefined);
});

test("non-persistent Ultrafast does not overwrite the saved tier", async (t) => {
  const fixture = await extensionFixture(t, { persistState: false }, solModel);
  await fixture.commands.get("ultrafast")!.handler("on", fixture.ctx);
  await fixture.commands.get("openai-tier")!.handler("status", fixture.ctx);
  assert.equal((await capturePayload(fixture)).service_tier, "ultrafast");
  assert.equal(readConfig(fixture.paths.project)?.serviceTier, "priority");
});

test("both providers send the requested tier and price the returned tier", async (t) => {
  const token = `test.${Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "test-account" },
  })).toString("base64url")}.test`;
  for (const provider of ["openai", "openai-codex"]) {
    for (const [requested, returned, multiplier] of [
      ["priority", "priority", 2],
      ["priority", "fast", 2],
      ["priority", "default", 1],
      ["ultrafast", "ultrafast", 6],
      ["ultrafast", "default", 1],
      ["ultrafast", undefined, 6],
    ] as const) {
      await t.test(`${provider}: ${requested} requested, ${returned} returned`, async (t) => {
        const model: Model<Api> = {
          ...solModel,
          provider,
          api: provider === "openai" ? "openai-responses" : "openai-codex-responses",
        };
        const fixture = await extensionFixture(t, { active: true, serviceTier: requested as ServiceTier }, model);
        let payload: Record<string, unknown> | undefined;
        t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
          const body = typeof init.body === "string" ? init.body : zstdDecompressSync(init.body as Uint8Array).toString();
          payload = JSON.parse(body);
          const completed = {
            type: "response.completed",
            response: {
              id: "resp_test",
              status: "completed",
              service_tier: returned,
              output: [],
              usage: {
                input_tokens: 1000,
                output_tokens: 100,
                total_tokens: 1100,
                input_tokens_details: { cached_tokens: 500 },
              },
            },
          };
          return new Response(`data: ${JSON.stringify(completed)}\n\n`, {
            headers: { "content-type": "text/event-stream" },
          });
        });
        const observedEvents: unknown[] = [];
        const result = await fixture.providers.get(provider)!.streamSimple!(model, normalizeContext({ messages: [] }), {
          apiKey: token,
          transport: "sse",
          reasoning: "high",
          onProviderStreamEvent(data) { observedEvents.push(data); },
        }).result();
        assert.equal(result.stopReason, "stop", result.errorMessage);
        assert.equal(payload?.service_tier, requested);
        assert.deepEqual(payload?.reasoning, { effort: "high", summary: "auto" });
        assert.equal(observedEvents.length, 1);
        const codexDefault = provider === "openai-codex" && returned === "default";
        const expectedMultiplier = codexDefault ? requested === "ultrafast" ? 6 : 2 : multiplier;
        const status = codexDefault ? "unconfirmed (backend default)"
          : returned === "fast" ? "priority" : returned ?? "unconfirmed";
        assert.equal(fixture.statuses.get(_test.STATUS_KEY),
          `gpt-6.1-sol ${status} (requested ${requested})`);
        for (const [key, base] of [["input", 0.001], ["output", 0.001], ["cacheRead", 0.00005], ["cacheWrite", 0]] as const) {
          assert.ok(Math.abs(result.usage.cost[key] - base * expectedMultiplier) < 1e-12);
        }
        assert.ok(Math.abs(result.usage.cost.total - 0.00205 * expectedMultiplier) < 1e-12,
          `Expected ${0.00205 * expectedMultiplier}, got ${result.usage.cost.total}`);
      });
    }
  }
});

test("resolveConfig creates default global config", () => {
  const cwd = tempDir();
  const home = tempDir();
  try {
    const paths = configPaths(cwd, home);
    const config = resolveConfig(cwd, home);
    assert.equal(existsSync(paths.global), true);
    assert.equal(config.active, false);
    assert.equal(config.serviceTier, "priority");
    assert.equal(config.supportedModels.some((model) => model.provider === "openai" && model.id === "gpt-5.5"), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});
