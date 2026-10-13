# pi-openai-service-tier

[![CI](https://github.com/anirudhmehra/pi-openai-service-tier/actions/workflows/ci.yml/badge.svg)](https://github.com/anirudhmehra/pi-openai-service-tier/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/anirudhmehra/pi-openai-service-tier?include_prereleases&sort=semver)](https://github.com/anirudhmehra/pi-openai-service-tier/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

OpenAI Fast/Ultrafast service-tier requests with API-price estimates for [Pi](https://github.com/earendil-works/pi).

**Release status:** the features below describe unreleased `main`. npm and the latest GitHub release are still `0.1.4`, which does not include `/ultrafast` or the current fast-mode fixes. The next release is held while Codex tier application remains unconfirmed.

Most fast-mode extensions only patch the outgoing JSON payload:

```ts
{ service_tier: "priority" }
```

That can route the request correctly, but Pi's displayed cost accounting uses its internal provider option named `serviceTier`. This extension wraps Pi's built-in OpenAI provider calls and passes:

```ts
{ ...options, serviceTier: "priority" }
```

This supplies the OpenAI request field without losing Pi's request hooks and usage accounting. The extension also handles Ultrafast pricing and the returned `fast` alias. Costs remain estimates based on Pi's model-price metadata, not a billing receipt or proof that a speed tier was applied.

## Features

- `/fast` selects or toggles the `priority` tier, even after another tier was selected.
- `/ultrafast` selects or toggles `ultrafast` for GPT-6 Astra and GPT-6.1 Sol.
- `/openai-tier` selects `priority`, `ultrafast`, `flex`, `default`, `auto`, or `scale`.
- Works with the `openai` and `openai-codex` providers' Responses APIs.
- Avoids sending tiers unsupported by the selected model/API.
- Includes `gpt-5.4`, `gpt-5.5`, `gpt-6-astra`, and `gpt-6.1-sol` on both providers by default.
- Separates requested tiers from backend-reported tiers in the footer.
- Keeps non-persistent mode changes active when checking status.
- Does **not** change model, reasoning level, prompts, tools, or `text.verbosity`.
- Does **not** make network calls of its own.
- Stores simple JSON config with project-over-global precedence.

## Install

The released npm package remains available, but currently installs `0.1.4` without the unreleased features described here:

```bash
pi install npm:pi-openai-service-tier
```

To try unreleased `main`, install from GitHub:

```bash
pi install https://github.com/anirudhmehra/pi-openai-service-tier
```

Then start Pi normally:

```bash
pi --provider openai-codex --model gpt-5.5
```

Enable priority tier at startup:

```bash
pi --provider openai-codex --model gpt-5.5 --fast
```

From a local checkout, try unreleased `main` without installing:

```bash
pi -e ./index.ts --provider openai-codex --model gpt-5.5 --fast
```

## Commands

### Fast mode

```text
/fast
/fast on
/fast off
/fast status
```

`/fast on` always selects `priority`. `/fast` turns it off if Priority is already active; otherwise it switches to Priority.

### Ultrafast mode

Choose an eligible model first:

```bash
pi --provider openai-codex --model gpt-6.1-sol
```

```text
/ultrafast
/ultrafast on
/ultrafast off
/ultrafast status
```

The same commands work with `openai/gpt-6-astra` and `openai/gpt-6.1-sol` using an API key. There is no `--ultrafast` CLI flag; `--fast` remains the startup flag for Priority.

Ultrafast requires backend access as well as a supported model. See [confirmation and billing](#confirmation-and-billing) before enabling it.

### Explicit service tier

```text
/openai-tier priority
/openai-tier ultrafast
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
  "serviceTier": "priority",
  "supportedModels": [
    "openai/gpt-5.4",
    "openai/gpt-5.5",
    "openai/gpt-6-astra",
    "openai/gpt-6.1-sol",
    "openai-codex/gpt-5.4",
    "openai-codex/gpt-5.5",
    "openai-codex/gpt-6-astra",
    "openai-codex/gpt-6.1-sol"
  ]
}
```

### Config fields

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `persistState` | boolean | `true` | Whether `/fast`, `/ultrafast`, and `/openai-tier` save mode changes across sessions. |
| `active` | boolean | `false` | Whether a service tier is requested. |
| `serviceTier` | `priority` \| `ultrafast` \| `flex` \| `default` \| `auto` \| `scale` | `priority` | Requested service tier, sent only when supported by the selected model/API. |
| `supportedModels` | string[] | see above | Allow-list of `provider/model-id` pairs that should receive `serviceTier`. |

Existing configuration files keep their explicit `supportedModels` lists; upgrading does not automatically add new models. Add the desired provider/model keys yourself and run `/reload` after editing configuration. Status commands report the current session state without reloading saved state.

## Supported providers/APIs

The extension applies tiers only when all of these are true:

1. the model belongs to `openai` or `openai-codex` and appears in `supportedModels`,
2. the model uses one of these Pi APIs:
   - `openai-responses`
   - `openai-codex-responses`, and
3. the selected tier is supported by that API.

Provider-specific tier support:

| Pi API | Supported tiers |
| --- | --- |
| `openai-responses` | `priority`, `ultrafast`, `flex`, `default`, `auto`, `scale` |
| `openai-codex-responses` | `priority`, `ultrafast` |

Ultrafast is restricted to `gpt-6-astra` and `gpt-6.1-sol`. An allow-list entry does not add a model to Pi's provider catalog or grant account/workspace access.

If a tier is configured but unsupported by the current model/provider, the extension leaves `serviceTier` unset for that request instead of sending an invalid value.

## Confirmation and billing

The footer initially says `<model> <tier> requested`. After a completed response it shows the reported tier, or `unconfirmed` when the response cannot establish which tier was applied. `/fast status` and `/ultrafast status` describe the selected request mode, not a verified speedup.

### OpenAI API

Ultrafast requests also send `OpenAI-Service-Tier: ultrafast`, as [required by OpenAI's API alpha FAQ](https://help.openai.com/en/articles/11647665-fast-mode-faq). The header is omitted for other tiers; the alpha rejects other header values with HTTP 400. Live API validation still requires an API key with Ultrafast access.

The API response's `service_tier` identifies the processing tier used. A returned `fast` is treated as the Priority alias; a returned `default` uses Standard pricing even if a faster tier was requested. Missing tier metadata leaves the request unconfirmed and uses the requested-tier price estimate.

Fast pricing follows Pi's current multipliers: 2x Standard, or 2.5x for GPT-5.5. Ultrafast API pricing is 6x Standard for GPT-6 Astra and GPT-6.1 Sol. Existing model/context-price rules remain applicable. See [OpenAI pricing](https://developers.openai.com/api/docs/pricing?latest-pricing=ultrafast).

### Codex subscription limitation

Codex can complete a correctly formed Fast/Ultrafast request while reporting `service_tier: "default"`. That does not confirm that the paid speed tier was applied. The extension shows, for example:

```text
gpt-6.1-sol unconfirmed (backend default) (requested ultrafast)
```

For this ambiguous Codex response, it preserves Pi's requested-tier API-price estimate rather than claiming confirmed Standard billing. This estimate is **not** the amount deducted from a ChatGPT subscription allowance or credit balance.

Live checks reproduced the missing confirmation over HTTP and WebSocket with `x-codex-routing-hint`, the API alpha header, and the candidate `x-codex-beta-features: ultrafast_mode` header. None established a working Codex fix. These experimental headers are not added to Codex requests by the extension. Related upstream reports: [Codex #30413](https://github.com/openai/codex/issues/30413) and [Codex #32191](https://github.com/openai/codex/issues/32191).

Codex eligibility is separate from API eligibility. OpenAI currently documents Ultrafast for Pro $500 and eligible Enterprise/Edu workspaces, with different allowance/credit multipliers. See [OpenAI's Work/Codex guidance](https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex). A client toggle cannot override backend eligibility or force tier application.

## Compatibility notes

Unreleased `main` requires Pi 1.1.0+ (`@earendil-works/pi-ai` and `@earendil-works/pi-coding-agent`) and Node.js 22.19.0+.

The extension overrides the `openai` provider's `openai-responses` stream and the `openai-codex` provider's `openai-codex-responses` stream, then delegates to Pi's built-in implementations. Other APIs are not overridden. Existing request hooks are preserved. Another extension overriding the same provider stream can replace this behavior.

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
pi -e ./index.ts --provider openai-codex --model gpt-5.5 --fast
```

## Security

Pi extensions run with your local user permissions. This extension only reads/writes its config JSON files and delegates LLM calls to Pi's built-in OpenAI providers; it does not perform independent network requests.

## License

MIT
