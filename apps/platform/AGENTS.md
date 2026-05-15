<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

<!-- CLERK POLICY - DO NOT TOUCH -->
# Clerk Changes Policy (Do Not Touch)

- Do NOT modify Clerk configuration or code anywhere unless the user explicitly asks you to.
- This prohibition applies to all apps (platform, web, marketing, home, huckleberry-drive) and any shared packages.
- Do not add, remove, or change any of the following without explicit user approval:
  - `ClerkProvider` props (e.g. `domainUrl`, `proxyUrl`, `clerkJSVersion`, `clerkJSUrl`, UI-related props)
  - Environment variables related to Clerk (e.g. `NEXT_PUBLIC_CLERK_*`, `CLERK_*`)
  - Any dashboard-domain or proxy wiring in code
- If you believe a Clerk change is necessary to fix a build or runtime issue: stop, report the exact error, and wait for explicit permission before acting.
