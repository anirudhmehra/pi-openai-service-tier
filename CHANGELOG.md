# Changelog

## 0.1.3 - 2026-05-03

- Add `scale` as a supported `openai-responses` service tier, matching OpenAI SDK response types.
- Keep `openai-codex-responses` priority-only.

## 0.1.2 - 2026-05-03

- Avoid sending unsupported service tiers to OpenAI Codex Responses.
- Treat `openai-codex-responses` as `priority`-only; `flex`, `default`, and `auto` are left unset for Codex requests.
- Document provider-specific tier support.

## 0.1.1 - 2026-05-03

- Polish README with clearer install, config, update, uninstall, compatibility, and security notes.
- Add `npm run check` and `npm run pack:dry-run` scripts.
- Add GitHub Actions CI.
- Add issue tracker/homepage package metadata.
- Add contributing/security docs, issue templates, PR template, and CODEOWNERS.

## 0.1.0 - 2026-05-03

- Initial cost-correct OpenAI service tier extension.
- Add `/fast`, `/openai-tier`, and `--fast` support.
- Wrap Pi OpenAI/OpenAI-Codex providers with Pi's internal `serviceTier` option.
