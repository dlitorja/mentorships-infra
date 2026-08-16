# `@mentorships/security`

Shared security utilities for the Mentorships monorepo.

## Contents

- `turnstile` — Cloudflare Turnstile token verification and client IP extraction.

## Usage

```ts
import { isTurnstileTokenValid, getClientIp } from "@mentorships/security";

const ip = getClientIp(request);
const isValid = await isTurnstileTokenValid(token, { remoteIp: ip });
```

## Environment variables

- `TURNSTILE_SECRET_KEY` — Cloudflare Turnstile secret key.

For client-side widgets, also set `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
