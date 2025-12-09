# CI/CD Setup Guide

## Overview

This repository uses:
- **GitHub Actions** for CI/CD pipelines
- **BuildJet** as self-hosted runners (faster, more reliable)
- **Mend Renovate** for automated dependency updates
- **Vercel** for deployments

---

## BuildJet Runners

### Setup

1. **Install BuildJet GitHub App**
   - Go to [BuildJet](https://buildjet.com)
   - Install the GitHub App
   - Connect your repository: `dlitorja/mentorships-infra`

2. **Configure Runners**
   - BuildJet automatically provides runners
   - No additional configuration needed
   - Runners are available as `runs-on: buildjet`

### Benefits

- ✅ **Faster execution** - Better hardware than GitHub-hosted
- ✅ **More reliable** - Dedicated resources
- ✅ **Cost-effective** - Better value than GitHub-hosted
- ✅ **Scalable** - Handles concurrent jobs well

### Usage in Workflows

All workflows use BuildJet runners:
```yaml
jobs:
  test:
    runs-on: buildjet  # Uses BuildJet runner
```

---

## Mend Renovate

### Setup

1. **Install Renovate GitHub App**
   - Go to [Mend Renovate](https://github.com/apps/renovate)
   - Install the app
   - Select repository: `dlitorja/mentorships-infra`
   - Renovate will use `renovate.json` configuration

2. **Configuration File**
   - Location: `renovate.json` (root)
   - Already configured with:
     - Semantic commits
     - Dependency grouping
     - Auto-merge for safe updates
     - Manual review for major updates

### Features

**Automatic Updates:**
- ✅ Patch updates (auto-merged)
- ✅ Minor updates (grouped, requires review)
- ✅ Major updates (requires manual review)

**Grouping:**
- Testing dependencies grouped together
- Database dependencies grouped together
- UI dependencies grouped together
- TypeScript/types grouped together

**Security:**
- Vulnerability alerts enabled
- Security patches prioritized
- Labels applied automatically

**Schedule:**
- Runs weekly (Monday before 10am)
- Dependency dashboard for overview
- Lock file maintenance monthly

### Renovate Dashboard

Renovate creates a dependency dashboard issue that shows:
- All available updates
- Grouped PRs
- Security vulnerabilities
- Update status

Access via: GitHub Issues → "🔄 Dependency Updates"

---

## GitHub Actions Workflows

### Test Workflow (`.github/workflows/test.yml`)

**Triggers:**
- Push to `main` or `develop`
- Pull requests
- Manual trigger

**Jobs:**
1. **lint-and-typecheck** - Fast feedback
2. **unit-tests** - Unit test suite
3. **e2e-tests** - E2E test suite
4. **build** - Verify build succeeds

**Runners:** BuildJet

### Deploy Workflow (`.github/workflows/deploy.yml`)

**Triggers:**
- Push to `main`
- Manual trigger

**Jobs:**
1. **deploy** - Build and deploy to Vercel

**Runners:** BuildJet

---

## Required Secrets

### GitHub Repository Secrets

Configure in: Settings → Secrets and variables → Actions

**Required Secrets:**
```
STRIPE_SECRET_KEY              # Stripe test/live key
STRIPE_WEBHOOK_SECRET          # Stripe webhook secret
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  # Stripe publishable key
VERCEL_TOKEN                   # Vercel deployment token
VERCEL_ORG_ID                  # Vercel organization ID
VERCEL_PROJECT_ID              # Vercel project ID
```

**Optional Secrets (for full testing):**
```
CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

---

## Workflow Status

### Check Status

- **GitHub Actions Tab** - View all workflow runs
- **PR Checks** - See status in pull requests
- **Badges** - Add status badges to README (optional)

### Status Badges (Optional)

Add to README.md:
```markdown
![Tests](https://github.com/dlitorja/mentorships-infra/actions/workflows/test.yml/badge.svg)
![Deploy](https://github.com/dlitorja/mentorships-infra/actions/workflows/deploy.yml/badge.svg)
```

---

## Renovate Configuration

### Key Settings

**Auto-merge:**
- ✅ Patch updates for dev dependencies
- ✅ Patch updates for type packages
- ❌ Major updates (require review)

**Grouping:**
- Related dependencies grouped together
- Reduces PR noise
- Easier to review

**Schedule:**
- Weekly updates (Monday)
- Monthly lock file maintenance

**Security:**
- Vulnerability alerts enabled
- Security patches prioritized

### Customization

Edit `renovate.json` to:
- Change update schedule
- Adjust grouping rules
- Modify auto-merge settings
- Add custom package rules

---

## Best Practices

### For Developers

1. **Check Renovate PRs Weekly**
   - Review dependency dashboard
   - Merge safe updates
   - Review major updates carefully

2. **Monitor CI/CD Status**
   - Check workflow runs regularly
   - Fix failing tests promptly
   - Keep secrets up to date

3. **Test Before Merging**
   - Run tests locally before pushing
   - Wait for CI to pass before merging
   - Review Renovate PRs carefully

### For CI/CD

1. **Fast Feedback**
   - Lint and type check run first
   - Fail fast on errors
   - Parallel job execution

2. **Reliable Builds**
   - Use BuildJet for consistency
   - Cache dependencies
   - Clean builds on main branch

3. **Security**
   - Never commit secrets
   - Use GitHub Secrets
   - Rotate keys regularly

---

## Troubleshooting

### BuildJet Issues

**Runners not available:**
- Check BuildJet app is installed
- Verify repository connection
- Check BuildJet dashboard

**Slow execution:**
- Check BuildJet status
- Verify runner availability
- Contact BuildJet support if needed

### Renovate Issues

**PRs not created:**
- Check Renovate app is installed
- Verify `renovate.json` is valid
- Check Renovate logs in GitHub

**Too many PRs:**
- Adjust `prConcurrentLimit` in `renovate.json`
- Enable more grouping
- Increase `prHourlyLimit`

### Workflow Issues

**Tests failing:**
- Check test logs
- Verify secrets are set
- Test locally first

**Deployment failing:**
- Check Vercel credentials
- Verify build succeeds locally
- Check Vercel logs

---

## Next Steps

1. ✅ **Install BuildJet** - Set up runners
2. ✅ **Install Renovate** - Enable dependency updates
3. ✅ **Configure Secrets** - Add required secrets
4. ⏳ **Test Workflows** - Verify everything works
5. ⏳ **Monitor** - Keep an eye on CI/CD status

---

## Resources

- [BuildJet Documentation](https://docs.buildjet.com)
- [Mend Renovate Documentation](https://docs.renovatebot.com)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Vercel Documentation](https://vercel.com/docs)

---

**Last Updated**: Current Session  
**Status**: Configured and ready for use

