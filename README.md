# pi-openai-service-tier

Cost-correct OpenAI service tier / fast mode for [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

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
- `/openai-tier` selects `priority`, `flex`, `default`, or `auto`.
- Works with Pi's OpenAI Responses and OpenAI Codex Responses providers.
- Includes `gpt-5.4` and `gpt-5.5` OpenAI/Codex models by default.
- Does **not** change model, reasoning level, prompts, tools, or `text.verbosity`.
- Does **not** make network calls of its own.
- Stores simple JSON config with project-over-global precedence.

## Install

```bash
pi install git:github.com/anirudhmehra/pi-openai-service-tier
```

Then start Pi normally:

```bash
pi --provider openai-codex --model gpt-5.5
```

Enable priority tier at startup:

```bash
pi --provider openai-codex --model gpt-5.5 --fast
```

Try without installing:

```bash
pi -e git:github.com/anirudhmehra/pi-openai-service-tier --provider openai-codex --model gpt-5.5 --fast
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
  "serviceTier": "priority",
  "supportedModels": [
    "openai/gpt-5.4",
    "openai/gpt-5.5",
    "openai-codex/gpt-5.4",
    "openai-codex/gpt-5.5"
  ]
}
```

### Config fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `persistState` | boolean | `true` | Whether `/fast` and `/openai-tier` persist state across sessions. |
| `active` | boolean | `false` | Whether a service tier is active. |
| `serviceTier` | `priority` \| `flex` \| `default` \| `auto` | `priority` | Service tier passed to Pi's OpenAI provider option. |
| `supportedModels` | string[] | see above | Allow-list of `provider/model-id` pairs that should receive `serviceTier`. |

Add/remove allow-listed models by editing `supportedModels`.

## Supported providers/APIs

The extension applies tiers only when both are true:

1. the model appears in `supportedModels`, and
2. the model uses one of these Pi APIs:
   - `openai-responses`
   - `openai-codex-responses`

## Compatibility notes

This extension overrides Pi's API stream handlers for:

- `openai-responses`
- `openai-codex-responses`

It delegates back to Pi's built-in OpenAI implementations, adding `serviceTier` only for configured/supported OpenAI models. If another extension also overrides those API handlers, whichever extension loads last wins.

Requires Pi / `@mariozechner/pi-ai` `>=0.72.1` and Node.js `>=22`.

## Updating

For git installs, re-run:

```bash
pi install git:github.com/anirudhmehra/pi-openai-service-tier
```

## Uninstall

```bash
pi remove git:github.com/anirudhmehra/pi-openai-service-tier
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
pi -e ./index.ts --provider openai-codex --model gpt-5.5 --fast
```

## Security

Pi extensions run with your local user permissions. This extension only reads/writes its config JSON files and delegates LLM calls to Pi's built-in OpenAI providers; it does not perform independent network requests.

## License

MIT
