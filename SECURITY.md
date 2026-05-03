# Security Policy

## Supported versions

The latest version on the `main` branch is supported.

## Reporting a vulnerability

Please do **not** open a public issue for sensitive security reports.

Instead, email the repository owner or use GitHub's private vulnerability reporting if enabled for this repository.

Include:

- affected version/commit,
- reproduction steps,
- impact,
- suggested fix, if known.

## Security posture

This extension is intentionally small. It:

- reads/writes only its JSON config files,
- does not perform independent network requests,
- delegates LLM calls to Pi's built-in OpenAI providers,
- does not read OAuth/API-key files directly.

As with all Pi extensions, it runs with your local user permissions. Only install extensions from sources you trust.
