# Changelog

## Unreleased

- Add GPT-6 Sol and Luna for OpenAI and OpenAI Codex, and centralize verified model IDs for future additions.
- Document explicit opt-in for new generations and dated snapshots; unknown versions remain excluded by default.

- Add `additionalSupportedModels` to extend package defaults or a custom base list without freezing future default model updates.
- Add GPT-6 Astra (`gpt-6-astra`) to the default service-tier allow-list for OpenAI and OpenAI Codex.
- Support Pi 0.80.8+'s dynamic provider runtime by overlaying the built-in `openai` and `openai-codex` providers without replacing their model catalogs.
- Add cost-correct priority-tier support for GPT-5.6 Luna, Sol, and Terra on OpenAI and OpenAI Codex.
- Move Pi imports and peer dependencies to the `@earendil-works` packages.
- Stop freezing package model defaults in generated config files and migrate the generated 0.1.x allow-list while preserving custom allow-lists.

## 0.1.4 - 2026-05-03

- Make npm the primary install path in the README.
- Add package/gallery image metadata.
- Add social preview assets for GitHub and sharing.

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
