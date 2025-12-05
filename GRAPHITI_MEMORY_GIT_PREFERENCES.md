# Graphiti Memory - Git & GitHub Preferences

## Memory to Add to Graphiti

**Group ID**: `mentorships-infra`

### Memory Name
"Git & GitHub Workflow Preferences - Enterprise Standard"

### Memory Content (Episode Body)

**Commit Messages**: User prefers Conventional Commits format (Enterprise Standard). Format: `<type>(<scope>): <subject>`. Types include: feat, fix, refactor, docs, test, chore, perf, ci, build. Scope should be package/app name (auth, payments, db, web, bot) to help Greptile and CodeRabbit understand context and improve Vercel deployment tracking.

**Branch Naming**: Format `<type>/<short-description>`. Types: feat/, fix/, refactor/, docs/, test/, chore/. Examples: feat/stripe-integration, fix/user-sync-bug. Clear and scannable, works with all tools.

**PR Workflow (Optimized for Greptile/CodeRabbit/Vercel)**: Always create PRs (never push directly to main). PR titles follow Conventional Commits format. Comprehensive PR descriptions must include: What (changes made), Why (reason for changes), How (implementation approach), Testing (how to test), Related (link to issues/PRs). CodeRabbit auto-reviews enabled with assertive profile. Greptile benefits from clear PR descriptions for context. Vercel uses commit messages for deployment tracking.

**Merge Strategy**: Always use squash merge for feature branches. Creates clean history, single commit per PR, PR title becomes commit message. Better for Greptile indexing, preserves PR context while keeping history clean. Never force push to main/master branch.

**Commit Frequency**: Mix approach - starting with larger logical commits. Group related changes together, mix with smaller commits for incremental work. Focus on logical units of work. Squash merge consolidates anyway, so logical grouping is key.

**Pre-Commit Checks**: Always run `pnpm check` (lint + typecheck) before committing. Ensure all tests pass. Verify no sensitive data in commits. Check that migrations are included if schema changed.

**Tool Integration Benefits**: 
- Greptile: Conventional Commits help with semantic code search, clear PR descriptions provide context, squash merge creates cleaner history for indexing.
- CodeRabbit: Conventional Commits help categorize changes, comprehensive PR descriptions provide better review context, PR titles in Conventional Commits format improve analysis, auto-review enabled with assertive profile.
- Vercel: Conventional Commits generate better deployment messages, squash merge creates single clear commit per deployment, PR titles become deployment descriptions.

**Git Best Practices**: Always verify before committing (check git status, review diffs, ensure no .env files or secrets). Create feature branches from main, keep branches up to date, delete branches after merging. Use descriptive branch names matching PR scope.

---

## How to Add This Memory

If Graphiti MCP tools are available, use:

```typescript
add_memory(
  name="Git & GitHub Workflow Preferences - Enterprise Standard",
  episode_body="[Content from above]",
  group_id="mentorships-infra"
)
```

Or add via Graphiti API/interface with group_id: `mentorships-infra`

