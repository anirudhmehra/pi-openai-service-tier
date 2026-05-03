# pi-openai-service-tier

A small [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension for OpenAI service tiers.

It is designed to be **cost-correct**: instead of only patching the outgoing JSON payload with `service_tier`, it wraps Pi's OpenAI provider calls and passes Pi's internal `serviceTier` option. Pi's OpenAI/OpenAI-Codex providers use that option both to send `service_tier` and to apply the matching cost multiplier in displayed usage/costs.

## What it does

- Adds `/fast` to toggle `serviceTier: "priority"`.
- Adds `/openai-tier` to choose `priority`, `flex`, `default`, or `auto`.
- Supports OpenAI Responses and OpenAI Codex Responses models.
- Defaults to these allow-listed models:
  - `openai/gpt-5.4`
  - `openai/gpt-5.5`
  - `openai-codex/gpt-5.4`
  - `openai-codex/gpt-5.5`
- Does **not** change model, reasoning level, prompts, tools, or `text.verbosity`.
- Does **not** make any network calls of its own.

## Install from GitHub

```bash
pi install git:github.com/anirudhmehra/pi-openai-service-tier
```

Then start pi normally:

```bash
pi --provider openai-codex --model gpt-5.5
```

Or enable priority tier at startup:

```bash
pi --provider openai-codex --model gpt-5.5 --fast
```

## Try without installing

```bash
pi -e git:github.com/anirudhmehra/pi-openai-service-tier --provider openai-codex --model gpt-5.5 --fast
```

## Commands

Inside pi:

```text
/fast
/fast on
/fast off
/fast status
```

`/fast` toggles priority tier on/off.

```text
/openai-tier priority
/openai-tier flex
/openai-tier default
/openai-tier auto
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

If no config exists, it creates a global default:

```json
{
  "persistState": true,
  "active": false,
  "serviceTier": "priority",
  "supportedModels": [
    "openai/gpt-5.4",
    "openai/gpt-5.5",
    "openai-codex/gpt-5.4",
    "openai-codex/gpt-5.5"
  ]
}
```

Add/remove allow-listed models by editing `supportedModels`.

## Why this exists

Many Pi fast-mode extensions do this:

```ts
return { ...payload, service_tier: "priority" };
```

That can send the right request to OpenAI, but Pi's cost accounting reads the provider option named `serviceTier`. This extension routes requests through Pi's full OpenAI provider APIs with:

```ts
{ ...options, serviceTier: "priority" }
```

So Pi gets both:

1. the correct `service_tier` request field, and
2. the correct Pi-side service-tier cost multiplier.

## Compatibility notes

This extension overrides Pi's API stream handlers for:

- `openai-responses`
- `openai-codex-responses`

It delegates back to Pi's built-in OpenAI implementations, adding `serviceTier` only for configured/supported OpenAI models. If another extension also overrides those API handlers, whichever extension loads last wins.

Requires Pi / `@mariozechner/pi-ai` `>=0.72.1`.

## Development

```bash
npm install
npm test
npm run typecheck
```

## License

MIT
