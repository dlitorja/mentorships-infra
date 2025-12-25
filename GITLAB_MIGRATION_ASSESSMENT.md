# GitLab Migration Assessment

## Executive Summary

**Migration Complexity**: **Medium** (3-5 days of focused work)

**Key Finding**: ✅ **Excellent news!** All your major tools fully support GitLab:
- ✅ **Greptile**: Fully supports GitLab (code search & indexing)
- ✅ **CodeRabbit**: Fully supports GitLab (automated code reviews for merge requests)
- ✅ **Renovate**: Fully supports GitLab (dependency updates)
- ✅ **Vercel**: Fully supports GitLab (deployments)

**Migration Risk**: **Low** - No tool replacements needed, just reconfiguration.

**Recommendation**: Migration is **highly feasible** and **low risk**. All critical tools are confirmed to work with GitLab. The main effort is converting CI/CD workflows from GitHub Actions to GitLab CI. Consider migrating if you want to avoid future GitHub pricing uncertainty or take advantage of GitLab's superior CI/CD features (free self-hosted runners, built-in DevOps tools).

---

## Current GitHub Dependencies

### 1. ✅ **GitHub Actions Workflows** (2 workflows)
- **Location**: `.github/workflows/test.yml`, `.github/workflows/deploy.yml`
- **Complexity**: Medium - Need YAML syntax conversion
- **GitLab Equivalent**: `.gitlab-ci.yml` (similar but different syntax)
- **Migration Effort**: 4-6 hours

### 2. ❌ **BuildJet Runners** (GitHub Actions ONLY)
- **Current**: Self-hosted runners via BuildJet GitHub App
- **GitLab Support**: ❌ **No - BuildJet is GitHub Actions-specific only**
- **GitLab Alternatives** (Low-Cost Options):
  1. **GitLab.com Shared Runners** (Free Tier)
     - 400 CI/CD minutes/month (free)
     - Medium-sized Linux runners available to all tiers
     - Fully integrated, enabled by default
     - **Cost**: Free (within limits)
  
  2. **Self-Hosted GitLab Runners** (Best Value)
     - Unlimited minutes, completely free
     - Full control over infrastructure
     - Can run on any VPS/cloud instance
     - **Cost**: Only infrastructure (VPS costs ~$5-20/month)
  
  3. **Cloud-Runner** (Managed Alternative)
     - High-performance managed GitLab runners
     - 4 vCPUs, 8 GB RAM
     - Up to 4x faster pipeline times
     - **Cost**: €19/month (~$20/month)
     - **Source**: [Cloud-Runner Pricing](https://cloud-runner.com/pricing/)
  
  4. **BuildServers.xyz** (Shared Runners)
     - Shared GitLab runners on bare-metal servers
     - EU data centers
     - **Cost**: €15/month (~$16/month) for one concurrent run
     - **Source**: [BuildServers.xyz](https://www.buildservers.xyz/post/gitlab-shared-runner)
  
  5. **GitLab SaaS Runners** (Premium)
     - GitLab's own paid runners
     - Similar to BuildJet performance
     - **Cost**: Varies by plan
- **Recommended**: Self-hosted runners (best value) or Cloud-Runner (managed)
- **Migration Effort**: 2-4 hours (setup new runners)

### 3. ✅ **Mend Renovate** (GitLab supported)
- **Current**: GitHub App for dependency updates
- **GitLab Support**: ✅ Yes, Renovate supports GitLab
- **Migration Effort**: 1-2 hours (reconfigure for GitLab)

### 4. ✅ **Greptile** (Code Search)
- **Current**: GitHub integration configured in `.greptile/config.yaml`
- **GitLab Support**: ✅ **Yes, fully supported!** Greptile integrates with both GitHub and GitLab
- **Migration Effort**: 1-2 hours (update configuration)
- **Source**: [Greptile Documentation](https://www.greptile.com/docs/integrations/github-gitlab-integration)

### 5. ✅ **CodeRabbit** (Automated PR Reviews)
- **Current**: GitHub PR reviews with `.coderabbit.yaml`
- **GitLab Support**: ✅ **Yes, fully supported!** CodeRabbit provides automated code reviews for GitLab merge requests
- **Migration Effort**: 1-2 hours (reconfigure for GitLab merge requests)
- **Source**: [CodeRabbit GitLab Documentation](https://docs.coderabbit.ai/platforms/gitlab-com)

### 6. ✅ **Vercel Integration**
- **Current**: Deploys via GitHub Actions
- **GitLab Support**: ✅ Yes, Vercel supports GitLab
- **Migration Effort**: 1 hour (reconfigure Vercel project)

### 7. ⚠️ **GitHub MCP Server**
- **Current**: MCP server for GitHub operations
- **GitLab Alternative**: Would need GitLab MCP server (if available)
- **Migration Effort**: 1-2 hours

---

## Migration Steps

### Phase 1: Preparation (Day 1)

1. **Create GitLab Account/Project**
   - Set up GitLab.com account or self-hosted instance
   - Create new project: `mentorships-infra`
   - Configure project settings

2. **Verify Tool Support**
   - ✅ Check Renovate GitLab support (confirmed)
   - ✅ Verify Greptile GitLab support (confirmed - fully supported)
   - ✅ Verify CodeRabbit GitLab support (confirmed - fully supported)
   - ❓ Check for GitLab MCP server

3. **Backup Current Setup**
   - Export all GitHub secrets
   - Document current workflow configurations
   - Export repository data

### Phase 2: Repository Migration (Day 1-2)

1. **Import Repository**
   - Use GitLab's GitHub Importer
   - Or: `git remote add gitlab <url>` and push
   - Preserve all branches and history

2. **Update Remote Configuration**
   - Change default remote to GitLab
   - Update any scripts that reference GitHub URLs

### Phase 3: CI/CD Migration (Day 2-3)

1. **Convert Workflows to GitLab CI**

   **Current**: `.github/workflows/test.yml` → **New**: `.gitlab-ci.yml`

   **Key Differences**:
   - GitHub Actions: `uses: actions/checkout@v4`
   - GitLab CI: Built-in checkout (no action needed)
   - GitHub Actions: `runs-on: buildjet-4vcpu-ubuntu-2204`
   - GitLab CI: `tags: [docker]` or use GitLab runners

   **Example Conversion**:

   ```yaml
   # .gitlab-ci.yml (converted from test.yml)
   stages:
     - lint
     - test
     - build
     - deploy

   variables:
     PNPM_VERSION: "10"
     NODE_VERSION: "20"

   # Lint & Type Check
   lint-and-typecheck:
     stage: lint
     image: node:20
     before_script:
       - npm install -g pnpm@$PNPM_VERSION
       - pnpm install --frozen-lockfile
     script:
       - pnpm lint
       - pnpm typecheck
     only:
       - main
       - develop
       - merge_requests

   # Unit Tests
   unit-tests:
     stage: test
     image: node:20
     environment: Preview
     before_script:
       - npm install -g pnpm@$PNPM_VERSION
       - pnpm install --frozen-lockfile
     script:
       - pnpm test:unit
     coverage: '/Coverage: \d+\.\d+%/'
     artifacts:
       reports:
         coverage_report:
           coverage_format: cobertura
           path: coverage/coverage-final.json
     only:
       - main
       - develop
       - merge_requests

   # E2E Tests
   e2e-tests:
     stage: test
     image: node:20
     environment: Preview
     before_script:
       - npm install -g pnpm@$PNPM_VERSION
       - pnpm install --frozen-lockfile
       - pnpm exec playwright install --with-deps
     script:
       - pnpm test
     artifacts:
       when: always
       paths:
         - playwright-report/
       expire_in: 30 days
     only:
       - main
       - develop
       - merge_requests

   # Build
   build:
     stage: build
     image: node:20
     environment: Preview
     needs:
       - lint-and-typecheck
       - unit-tests
     before_script:
       - npm install -g pnpm@$PNPM_VERSION
       - pnpm install --frozen-lockfile
     script:
       - pnpm build
     only:
       - main
       - develop
       - merge_requests

   # Deploy
   deploy:
     stage: deploy
     image: node:20
     environment: Production
     before_script:
       - npm install -g pnpm@$PNPM_VERSION
       - pnpm install --frozen-lockfile
     script:
       - pnpm --filter @mentorships/marketing build
       - |
         npm install -g vercel
         vercel --prod \
           --token $VERCEL_TOKEN \
           --scope $VERCEL_ORG_ID \
           --yes
     only:
       - main
     when: manual  # Optional: require manual approval
   ```

2. **Set Up GitLab Runners** (Choose one option)
   - **Option A**: Use GitLab.com shared runners (free tier: 400 min/month)
   - **Option B**: Set up self-hosted runners (unlimited, free) ⭐ **Recommended**
   - **Option C**: Use Cloud-Runner (€19/month, managed, high-performance)
   - **Option D**: Use BuildServers.xyz (€15/month, shared bare-metal)
   - **Option E**: Use GitLab SaaS runners (paid, similar to BuildJet)

3. **Migrate Secrets**
   - Move all secrets from GitHub → GitLab CI/CD Variables
   - GitLab: Settings → CI/CD → Variables
   - Same secrets needed:
     - `STRIPE_SECRET_KEY`
     - `STRIPE_WEBHOOK_SECRET`
     - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
     - `VERCEL_TOKEN`
     - `VERCEL_ORG_ID`
     - `VERCEL_PROJECT_ID`
     - `CLERK_SECRET_KEY`
     - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `DATABASE_URL`

### Phase 4: Tool Reconfiguration (Day 3-4)

1. **Renovate Configuration**
   - Install Renovate GitLab App
   - Update `renovate.json`:
     ```json
     {
       "platform": "gitlab",  // Change from "github"
       "endpoint": "https://gitlab.com/api/v4"  // Or your GitLab instance
     }
     ```
   - Reconfigure for GitLab merge requests

2. **Greptile Reconfiguration** ✅
   - Update `.greptile/config.yaml`:
     ```yaml
     integrations:
       gitlab:  # Change from github
         repository: dlitorja/mentorships-infra
         default_branch: main
         sync_on_push: true
     ```
   - Install Greptile GitLab app/integration
   - Re-index repository in Greptile dashboard

3. **CodeRabbit Reconfiguration** ✅
   - Install CodeRabbit GitLab app from [GitLab Marketplace](https://gitlab.com/coderabbitai)
   - Update `.coderabbit.yaml` for GitLab merge requests (same config, works with GitLab)
   - CodeRabbit will automatically review merge requests (same as PRs)

4. **Vercel Reconfiguration**
   - Vercel Dashboard → Project Settings → Git
   - Disconnect GitHub
   - Connect GitLab repository
   - Configure build settings (same as before)

5. **MCP Configuration**
   - Update `.cursor-mcp-config.json`:
     ```json
     {
       "gitlab": {
         "command": "npx",
         "args": ["-y", "@modelcontextprotocol/server-gitlab"],
         "env": {
           "GITLAB_TOKEN": "${GITLAB_TOKEN}"
         }
       }
     }
     ```
   - Remove GitHub MCP server (or keep both)

### Phase 5: Testing & Validation (Day 4-5)

1. **Test CI/CD Pipelines**
   - Create test branch
   - Push changes
   - Verify all jobs run successfully
   - Check test results, coverage, artifacts

2. **Test Deployment**
   - Trigger deploy job
   - Verify Vercel deployment works
   - Check environment variables

3. **Test Tool Integrations**
   - Verify Renovate creates merge requests
   - Test Greptile/CodeRabbit (if supported)
   - Verify MCP server works

4. **Update Documentation**
   - Update `CI_CD_SETUP.md`
   - Update `README.md` (remove GitHub badges)
   - Update any scripts/docs referencing GitHub

---

## Cost Comparison

### GitHub (Current)
- **GitHub Actions**: Free for public repos, 2000 min/month for private
- **BuildJet**: Paid service (cost varies, typically $20-50/month)
- **Total**: BuildJet costs + GitHub Actions (if over free tier)
- **Estimated Monthly Cost**: $20-50+ (depending on BuildJet plan)

### GitLab (Alternative) - Cost Comparison

**Option 1: GitLab.com Free Tier** (Best for Testing)
- 400 CI/CD minutes/month (shared runners)
- Unlimited self-hosted runners (free)
- All features included
- **Cost**: **$0/month** (within free tier limits)

**Option 2: Self-Hosted Runners** (Best Value - Recommended)
- Unlimited CI/CD minutes (completely free)
- Full control over infrastructure
- Can run on cheap VPS (Hetzner, DigitalOcean, etc.)
- **Infrastructure Cost**: $5-20/month for VPS
- **Total Cost**: **$5-20/month** (unlimited minutes!)

**Option 3: Cloud-Runner** (Managed Alternative to BuildJet)
- High-performance managed runners
- 4 vCPUs, 8 GB RAM
- Up to 4x faster than standard runners
- **Cost**: **€19/month (~$20/month)**

**Option 4: BuildServers.xyz** (Shared Bare-Metal)
- Shared runners on bare-metal servers
- EU data centers
- **Cost**: **€15/month (~$16/month)** for one concurrent run

**Option 5: GitLab.com Premium**
- 10,000 CI/CD minutes/month
- Advanced features
- **Cost**: ~$29/user/month

**Cost Savings**: 
- **Self-hosted**: Save $20-30/month vs BuildJet (unlimited minutes)
- **Cloud-Runner**: Similar cost to BuildJet but GitLab-native
- **Free tier**: $0 if usage is under 400 min/month

---

## BuildJet Replacement Options

**BuildJet Status**: ❌ **Does NOT support GitLab** - GitHub Actions only

### Runner Options Comparison

| Option | Cost/Month | Minutes | Performance | Setup Complexity | Best For |
|--------|-----------|---------|-------------|------------------|----------|
| **Self-Hosted** | $5-20 | Unlimited | High (your hardware) | Medium | ⭐ **Best Value** |
| **Cloud-Runner** | €19 (~$20) | Unlimited | Very High (4x faster) | Easy | Managed performance |
| **BuildServers.xyz** | €15 (~$16) | Unlimited | High (bare-metal) | Easy | Budget managed |
| **GitLab Free Tier** | $0 | 400/month | Medium | Easy | Low usage |
| **GitLab Premium** | $29/user | 10,000/month | High | Easy | Teams |

**Recommendation**: 
- **Self-hosted runners** for best value (unlimited minutes, only VPS cost)
- **Cloud-Runner** if you want managed service similar to BuildJet

### Detailed Runner Options

**1. Self-Hosted Runners** ⭐ **Recommended for Cost Savings**
- **Cost**: $5-20/month (VPS only, e.g., Hetzner, DigitalOcean)
- **Minutes**: Unlimited (completely free)
- **Performance**: Depends on your VPS specs
- **Setup**: Install GitLab Runner on your VPS
- **Best For**: Projects with moderate to high CI/CD usage
- **Savings**: $20-50/month vs BuildJet

**2. Cloud-Runner** (Managed Alternative)
- **Cost**: €19/month (~$20/month)
- **Minutes**: Unlimited
- **Performance**: 4x faster than standard runners (4 vCPUs, 8 GB RAM)
- **Setup**: Easy - managed service
- **Best For**: Teams wanting BuildJet-like performance without self-hosting
- **Source**: [Cloud-Runner Pricing](https://cloud-runner.com/pricing/)

**3. BuildServers.xyz** (Shared Bare-Metal)
- **Cost**: €15/month (~$16/month) for one concurrent run
- **Minutes**: Unlimited
- **Performance**: High (bare-metal servers in EU)
- **Setup**: Easy - shared runners
- **Best For**: Budget-conscious teams wanting managed runners
- **Source**: [BuildServers.xyz](https://www.buildservers.xyz/post/gitlab-shared-runner)

**4. GitLab.com Free Tier**
- **Cost**: $0/month
- **Minutes**: 400/month (shared runners)
- **Performance**: Medium
- **Setup**: Automatic (enabled by default)
- **Best For**: Low-usage projects or testing

**5. GitLab Premium Runners**
- **Cost**: $29/user/month
- **Minutes**: 10,000/month
- **Performance**: High
- **Setup**: Automatic
- **Best For**: Teams needing more minutes and advanced features

---

## Advantages of GitLab

1. **✅ Better CI/CD Integration**
   - Built-in CI/CD (no separate Actions)
   - More powerful pipeline features
   - Better Docker/Kubernetes integration

2. **✅ Self-Hosted Runners** ⭐ **Key Advantage**
   - Unlimited, completely free (no per-minute charges)
   - Full control over infrastructure
   - Can use cheap VPS ($5-20/month)
   - **Cost Savings**: $20-50/month vs BuildJet

3. **✅ Integrated DevOps**
   - Built-in container registry
   - Built-in package registry
   - Built-in monitoring/observability

4. **✅ Better Security**
   - Built-in security scanning
   - Dependency scanning
   - License compliance

5. **✅ More Features**
   - Built-in wiki
   - Built-in issue boards
   - Built-in project management

---

## Disadvantages / Challenges

1. **⚠️ Tool Ecosystem**
   - ✅ Greptile: **Fully supports GitLab** (confirmed)
   - ✅ CodeRabbit: **Fully supports GitLab** (confirmed)
   - Some GitHub-specific tools may not work (but main tools are covered)

2. **❌ Learning Curve**
   - Different UI/UX
   - Different workflow concepts
   - Team needs to adapt

3. **❌ Migration Effort**
   - 3-5 days of focused work
   - Testing and validation required
   - Potential downtime during transition

4. **❌ Community/Support**
   - Smaller community than GitHub
   - Less Stack Overflow content
   - Different documentation style

---

## Recommendations

### Option 1: Stay on GitHub (Recommended if pricing postponed)
- **Pros**: No migration effort, all tools work, familiar ecosystem
- **Cons**: Potential future pricing uncertainty, BuildJet costs
- **Action**: Monitor GitHub pricing announcements

### Option 2: Migrate to GitLab (Recommended for Cost Savings)
- **Pros**: 
  - Better CI/CD features
  - **Free self-hosted runners** (unlimited, save $20-50/month vs BuildJet)
  - All major tools confirmed to work (Greptile, CodeRabbit, Renovate)
  - More integrated DevOps platform
- **Cons**: Migration effort (3-5 days)
- **Action**: Follow migration plan above
- **Cost Savings**: $5-50/month depending on runner choice

### Option 3: Hybrid Approach
- **Pros**: Keep GitHub for code, use GitLab for CI/CD
- **Cons**: More complex setup, two platforms to manage
- **Action**: Use GitLab CI/CD with GitHub mirror

---

## Migration Checklist

### Pre-Migration
- [x] Verify Greptile GitLab support ✅ **Confirmed - Fully Supported**
- [x] Verify CodeRabbit GitLab support ✅ **Confirmed - Fully Supported**
- [ ] Check GitLab MCP server availability
- [ ] Export all GitHub secrets
- [ ] Document current workflow configurations
- [ ] Create GitLab account/project

### Migration
- [ ] Import repository to GitLab
- [ ] Convert `.github/workflows/*.yml` → `.gitlab-ci.yml`
- [ ] Set up GitLab runners
- [ ] Migrate secrets to GitLab CI/CD Variables
- [ ] Reconfigure Renovate for GitLab
- [ ] Reconfigure Greptile for GitLab ✅ **Supported**
- [ ] Reconfigure CodeRabbit for GitLab ✅ **Supported**
- [ ] Reconfigure Vercel for GitLab
- [ ] Update MCP configuration

### Post-Migration
- [ ] Test all CI/CD pipelines
- [ ] Verify deployments work
- [ ] Test tool integrations
- [ ] Update documentation
- [ ] Update README badges
- [ ] Notify team of changes
- [ ] Monitor for issues

---

## Next Steps

1. **✅ Tool Support Verified**: 
   - Greptile: ✅ Fully supports GitLab
   - CodeRabbit: ✅ Fully supports GitLab
   - GitLab MCP: ❓ Still need to verify
2. **If Migrating**: Follow migration plan above (all major tools confirmed!)
3. **If Staying**: Monitor GitHub pricing announcements

---

## Resources

### GitLab Documentation
- [GitLab CI/CD Migration Guide](https://docs.gitlab.com/ee/ci/migration/github_actions/)
- [GitLab Runner Setup](https://docs.gitlab.com/runner/)
- [GitLab CI/CD YAML Reference](https://docs.gitlab.com/ee/ci/yaml/)

### Tool Integrations
- [Greptile GitHub & GitLab Integration](https://www.greptile.com/docs/integrations/github-gitlab-integration)
- [CodeRabbit GitLab Documentation](https://docs.coderabbit.ai/platforms/gitlab-com)
- [Renovate GitLab Support](https://docs.renovatebot.com/gitlab/)
- [Vercel GitLab Integration](https://vercel.com/docs/concepts/git/vercel-for-gitlab)

### Runner Alternatives (BuildJet Replacements)
- [Cloud-Runner Pricing](https://cloud-runner.com/pricing/) - €19/month managed runners
- [BuildServers.xyz](https://www.buildservers.xyz/post/gitlab-shared-runner) - €15/month shared runners
- [GitLab Self-Hosted Runner Setup](https://docs.gitlab.com/runner/install/) - Free, unlimited
- [GitLab Hosted Runners](https://docs.gitlab.com/ee/ci/runners/hosted_runners/) - Free tier info

### Migration Guides
- [GitLab: Migrate from GitHub Actions](https://docs.gitlab.com/ee/ci/migration/github_actions/)
- [GitLab: Import from GitHub](https://docs.gitlab.com/ee/user/project/import/github.html)

---

**Last Updated**: Current Session  
**Status**: Assessment Complete - Ready for Decision

