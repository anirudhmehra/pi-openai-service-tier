# pi-openai-service-tier

[![CI](https://github.com/anirudhmehra/pi-openai-service-tier/actions/workflows/ci.yml/badge.svg)](https://github.com/anirudhmehra/pi-openai-service-tier/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/anirudhmehra/pi-openai-service-tier?include_prereleases&sort=semver)](https://github.com/anirudhmehra/pi-openai-service-tier/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Cost-correct OpenAI service tier / fast mode for [pi](https://github.com/earendil-works/pi/tree/main/packages/coding-agent).

Most fast-mode extensions only patch the outgoing JSON payload:

```ts
{ service_tier: "priority" }
```

That can route the request correctly, but Pi's displayed cost accounting uses its internal provider option named `serviceTier`. This extension wraps Pi's built-in OpenAI provider calls and passes:

```ts
{ ...options, serviceTier: "priority" }
```

So Pi gets both the OpenAI request field and the matching Pi-side service-tier cost multiplier.

## Features

- `/fast` toggles cost-correct `priority` tier.
- `/openai-tier` selects `priority`, `flex`, `default`, `auto`, or `scale`.
- Works with Pi's OpenAI Responses and OpenAI Codex Responses providers.
- Avoids sending tiers that a provider does not support.
- Includes `gpt-5.4`, `gpt-5.5`, the `gpt-5.6` Luna/Sol/Terra models, and the `gpt-6` Astra/Sol/Luna models on OpenAI/Codex by default.
- Preserves Pi's dynamically refreshed OpenAI and OpenAI Codex model catalogs.
- Does **not** change model, reasoning level, prompts, tools, or `text.verbosity`.
- Does **not** make network calls of its own.
- Stores simple JSON config with project-over-global precedence.

## Install

```bash
pi install npm:pi-openai-service-tier
```

GitHub install also works:

```bash
pi install https://github.com/anirudhmehra/pi-openai-service-tier
```

Then start Pi normally:

```bash
pi --provider openai-codex --model gpt-5.6-sol
```

Enable priority tier at startup:

```bash
pi --provider openai-codex --model gpt-5.6-sol --fast
```

Try without installing:

```bash
pi -e npm:pi-openai-service-tier --provider openai-codex --model gpt-5.6-sol --fast
```

## Commands

### Fast mode

```text
/fast
/fast on
/fast off
/fast status
```

`/fast` toggles `priority` service tier on/off.

### Explicit service tier

```text
/openai-tier priority
/openai-tier flex
/openai-tier default
/openai-tier auto
/openai-tier scale
/openai-tier off
/openai-tier status
```

`/openai-tier <tier>` enables that tier for supported models.

## Configuration

The extension uses project-over-global config:

```text
<repo>/.pi/extensions/pi-openai-service-tier.json
~/.pi/agent/extensions/pi-openai-service-tier.json
```

If neither file exists, the extension creates this global default on session start:

```json
{
  "persistState": true,
  "active": false,
  "serviceTier": "priority"
}
```

When `supportedModels` is omitted, the extension uses its package-maintained, cost-correct default allow-list. This lets package updates add newly supported models without freezing the model list in each user's config.

### Config fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `persistState` | boolean | `true` | Whether `/fast` and `/openai-tier` persist state across sessions. |
| `active` | boolean | `false` | Whether a service tier is active. |
| `serviceTier` | `priority` \| `flex` \| `default` \| `auto` \| `scale` | `priority` | Service tier passed to Pi's OpenAI provider option when supported by the current provider. |
| `supportedModels` | string[] | package-maintained list | Optional replacement allow-list of `provider/model-id` pairs that should receive `serviceTier`. |
| `additionalSupportedModels` | string[] | `[]` | Extra exact `provider/model-id` pairs appended to the effective base list, with duplicates removed. |

Set `supportedModels` only when you want to replace the package defaults. Config files containing the exact generated 0.1.x default list are migrated automatically to package-maintained defaults; custom lists remain unchanged.

### Adding newly released models

Prefer leaving `supportedModels` unset so plugin updates can add verified models automatically. To opt into a model before it is included in the package defaults, add it to `additionalSupportedModels`:

```json
{
  "persistState": true,
  "active": true,
  "serviceTier": "priority",
  "additionalSupportedModels": [
    "openai/example-new-model",
    "openai-codex/example-new-model"
  ]
}
```

Replace these example IDs with real model IDs. This only allows service-tier use; it does not register models in Pi. Verify the model's tier availability and Pi's pricing support first: discovery alone does not guarantee either. Wildcards are not supported. New generations and dated snapshots are treated as distinct IDs: add their exact IDs here after verifying support, rather than assuming they inherit the base model's tier availability or pricing. Existing aliases continue to match if their IDs stay unchanged.

The effective list is `supportedModels` (or package defaults if omitted) plus `additionalSupportedModels`, with duplicates removed. Project fields replace the corresponding global fields, rather than concatenating arrays. Set project `additionalSupportedModels: []` to clear inherited additions; omit it to inherit them. `supportedModels: []` empties the base list but still permits explicitly configured additions.

## Supported providers/APIs

The extension applies tiers only when all of these are true:

1. the model appears in the effective package or configured model allow-list,
2. the model uses one of these Pi APIs:
   - `openai-responses`
   - `openai-codex-responses`, and
3. the selected tier is supported by that API.

Provider-specific tier support:

| Pi API | Supported tiers |
| --- | --- |
| `openai-responses` | `priority`, `flex`, `default`, `auto`, `scale` |
| `openai-codex-responses` | `priority` |

If a tier is configured but unsupported by the current model/provider, the extension leaves `serviceTier` unset for that request instead of sending an invalid value.

## Compatibility notes

GPT-6 Astra, Sol, and Luna (`gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`) are allow-listed for priority/Fast mode on both providers. OpenAI currently permits only Standard processing for these models with EU data residency. See [OpenAI pricing](https://developers.openai.com/api/docs/pricing).

This extension overlays Pi's built-in `openai` and `openai-codex` providers without supplying a `models` array, so Pi's built-in and dynamically refreshed model catalogs remain available. It delegates back to Pi's built-in OpenAI implementations, adding `serviceTier` only for configured/supported OpenAI models.

If another extension also overrides either provider's stream handler, whichever extension loads last wins.

Requires Pi / `@earendil-works/pi-ai` `>=0.80.8` and Node.js `>=22.19`.

## Updating

For npm installs:

```bash
pi update npm:pi-openai-service-tier
```

For git installs, re-run:

```bash
pi install https://github.com/anirudhmehra/pi-openai-service-tier
```

## Uninstall

```bash
pi remove npm:pi-openai-service-tier
```

or, if installed from git:

```bash
pi remove https://github.com/anirudhmehra/pi-openai-service-tier
```

If desired, remove config files manually:

```bash
rm -f ~/.pi/agent/extensions/pi-openai-service-tier.json
rm -f .pi/extensions/pi-openai-service-tier.json
```

## Development

```bash
git clone https://github.com/anirudhmehra/pi-openai-service-tier.git
cd pi-openai-service-tier
npm install
npm run check
```

Local Pi smoke test:

```bash
pi -e ./index.ts --list-models
pi -e ./index.ts --provider openai-codex --model gpt-5.6-sol --fast
```

## Security

Pi extensions run with your local user permissions. This extension only reads/writes its config JSON files and delegates LLM calls to Pi's built-in OpenAI providers; it does not perform independent network requests.

## License

MIT
