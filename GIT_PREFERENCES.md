# Git & GitHub Preferences - CONFIRMED ✅

## Your Preferences (Confirmed)

### 1. Commit Messages
✅ **Conventional Commits** (Enterprise Standard)
- Format: `<type>(<scope>): <subject>`
- Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`, `build`
- Scope: Package/app name (e.g., `auth`, `payments`, `db`, `web`)
- **Why**: Industry standard, works excellently with Greptile, CodeRabbit, and Vercel

### 2. Branch Naming
✅ **Format**: `<type>/<short-description>`
- Types: `feat/`, `fix/`, `refactor/`, `docs/`, `test/`, `chore/`
- Examples: `feat/stripe-integration`, `fix/user-sync-bug`
- **Why**: Clear, scannable, works with all tools

### 3. PR Workflow (Optimized for Greptile/CodeRabbit/Vercel)
✅ **Comprehensive PR Descriptions**:
- **What**: What changes were made
- **Why**: Why these changes were needed
- **How**: Brief implementation approach
- **Testing**: How to test
- **Related**: Link to issues/PRs

✅ **PR Title**: Follows Conventional Commits format
✅ **CodeRabbit**: Auto-reviews enabled (assertive profile)
✅ **Greptile**: Benefits from clear PR descriptions for context
✅ **Vercel**: Uses commit messages for deployment tracking

### 4. Merge Strategy
✅ **Squash Merge** (Default)
- Creates clean history
- Single commit per PR
- PR title becomes commit message
- Better for Greptile indexing
- Preserves PR context

### 5. Commit Frequency
✅ **Mix Approach - Starting with Larger Logical Commits**
- Start with larger logical commits (group related changes)
- Mix with smaller commits for incremental work
- Focus on logical units of work
- Squash merge consolidates anyway, so logical grouping is key

## Tool Integration Benefits

### Greptile
- ✅ Conventional Commits help with semantic code search
- ✅ Clear PR descriptions provide context for code understanding
- ✅ Squash merge creates cleaner history for indexing

### CodeRabbit
- ✅ Conventional Commits help categorize changes
- ✅ Comprehensive PR descriptions provide better review context
- ✅ PR titles in Conventional Commits format improve analysis
- ✅ Auto-review enabled (assertive profile for thorough reviews)

### Vercel
- ✅ Conventional Commits generate better deployment messages
- ✅ Squash merge creates single, clear commit per deployment
- ✅ PR titles become deployment descriptions

## Workflow Summary

1. **Create branch**: `feat/stripe-integration`
2. **Make changes**: Larger logical commits
3. **Create PR**: 
   - Title: `feat(payments): add Stripe checkout integration`
   - Comprehensive description
   - Link related issues
4. **CodeRabbit reviews**: Auto-review triggered
5. **Address feedback**: Update PR
6. **Merge**: Squash merge (clean history)
7. **Vercel deploys**: Uses commit message for deployment

---

**Status**: ✅ All preferences confirmed and documented in `.cursorrules`
**Last Updated**: Preferences confirmed by user
