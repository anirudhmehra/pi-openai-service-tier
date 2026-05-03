# Contributing

Thanks for helping improve `pi-openai-service-tier`.

## Development setup

```bash
git clone https://github.com/anirudhmehra/pi-openai-service-tier.git
cd pi-openai-service-tier
npm install
npm run check
```

## Local smoke test

```bash
pi -e ./index.ts --list-models
pi -e ./index.ts --provider openai-codex --model gpt-5.5 --fast
```

## Pull requests

Before opening a PR, please run:

```bash
npm run check
```

Keep changes focused. This extension intentionally stays small:

- no independent network calls,
- no prompt/model/reasoning/verbosity changes,
- no broad provider behavior changes beyond passing Pi's `serviceTier` option.

## Release checklist

1. Update `package.json` version.
2. Update `CHANGELOG.md`.
3. Run `npm run check`.
4. Tag and create a GitHub release.
