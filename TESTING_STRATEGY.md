# Testing Strategy

## Overview

This document outlines our testing strategy, covering:
- **Unit Tests** (Vitest) - Fast, isolated function tests
- **E2E Tests** (Playwright) - Full user flow tests
- **Integration Tests** - API and service integration
- **CI/CD Integration** - Automated testing in pipelines

---

## Testing Pyramid

```
        /\
       /  \     E2E Tests (Playwright)
      /____\    - Critical user flows
     /      \   - Full integration
    /________\  - Slower, fewer tests
   /          \
  /____________\  Unit Tests (Vitest)
                 - Fast, many tests
                 - Function-level validation
```

---

## Unit Tests (Vitest)

### Purpose
- Test individual functions in isolation
- Fast execution (< 1 second per test)
- High coverage of business logic
- Mock external dependencies

### What to Test
- ✅ Payment processing functions
- ✅ Webhook verification logic
- ✅ Metadata parsing
- ✅ Error handling
- ✅ Validation functions
- ✅ Utility functions

### Location
```
tests/unit/
  ├── stripe/
  │   ├── webhooks.test.ts
  │   ├── checkout.test.ts
  │   └── refunds.test.ts
  ├── db/
  │   └── queries.test.ts
  └── utils/
      └── validation.test.ts
```

### Running Tests
```bash
pnpm test:unit           # Run all unit tests
pnpm test:unit:ui       # Run with UI
pnpm test:unit --watch  # Watch mode
pnpm test:unit --coverage  # With coverage
```

### Coverage Goals
- **Minimum**: 70% overall coverage
- **Critical paths**: 90%+ (payments, webhooks)
- **Utilities**: 80%+

---

## E2E Tests (Playwright)

### Purpose
- Test complete user flows
- Verify integration between components
- Catch regressions in critical paths
- Test real browser behavior

### What to Test
- ✅ Checkout flow (happy path)
- ✅ Payment processing
- ✅ Webhook handling
- ✅ Error scenarios
- ✅ Authentication flows
- ✅ Critical user journeys

### Location
```
tests/e2e/
  ├── stripe-checkout.spec.ts
  ├── authentication.spec.ts
  ├── booking.spec.ts
  └── payments.spec.ts
```

### Running Tests
```bash
pnpm test              # Run all E2E tests
pnpm test:ui           # Run with UI
pnpm test --project=chromium  # Specific browser
pnpm test --grep "checkout"  # Specific tests
```

### Test Data
- Use test Stripe keys
- Use test Clerk accounts
- Use test database (separate from dev)
- Clean up after tests

---

## Integration Tests

### Purpose
- Test API endpoints
- Test database interactions
- Test external service integration
- Verify data flow

### What to Test
- ✅ API route handlers
- ✅ Database queries
- ✅ Inngest functions
- ✅ Webhook processing
- ✅ Error responses

### Location
```
tests/integration/
  ├── api/
  │   ├── checkout.test.ts
  │   └── webhooks.test.ts
  ├── inngest/
  │   └── payments.test.ts
  └── db/
      └── queries.test.ts
```

### Running Tests
```bash
pnpm test:integration   # Run integration tests
```

---

## CI/CD Integration

### GitHub Actions with BuildJet Runners

**Files**: 
- `.github/workflows/test.yml` - Test workflow
- `.github/workflows/deploy.yml` - Deployment workflow

**Runners**: BuildJet (faster, more reliable than GitHub-hosted runners)

**Jobs:**
1. **Lint & Type Check** - Fast feedback
2. **Unit Tests** - Run on every PR
3. **E2E Tests** - Run on main/PRs
4. **Build** - Verify build succeeds
5. **Deploy** - Deploy to Vercel (main branch only)

### Workflow Triggers
- Push to `main` or `develop`
- Pull requests
- Manual trigger (workflow_dispatch)

### Secrets Required
- `STRIPE_SECRET_KEY` (test key)
- `STRIPE_WEBHOOK_SECRET` (test secret)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (test key)
- `VERCEL_TOKEN` (for deployment)
- `VERCEL_ORG_ID` (for deployment)
- `VERCEL_PROJECT_ID` (for deployment)
- Other service keys

### BuildJet Configuration
- All jobs use `runs-on: buildjet`
- Faster execution than GitHub-hosted runners
- Better resource allocation
- More reliable for CI/CD pipelines

---

## Testing Phases

### Phase 1: Current (Manual + Basic Scripts) ✅
- Manual testing procedures
- Basic automated script
- Good for initial development

### Phase 2: Unit Tests (Now) 🚀
- Set up Vitest
- Write unit tests for critical functions
- Achieve 70%+ coverage

### Phase 3: E2E Tests (Next)
- Set up Playwright
- Write E2E tests for critical flows
- Integrate into CI/CD

### Phase 4: Full Coverage (Future)
- Integration tests
- Performance tests
- Security tests
- Visual regression tests

---

## Test Organization

### File Naming
- Unit tests: `*.test.ts` or `*.spec.ts`
- E2E tests: `*.spec.ts`
- Integration tests: `*.test.ts`

### Test Structure
```typescript
describe("Feature Name", () => {
  describe("Function Name", () => {
    it("should do something", () => {
      // Arrange
      // Act
      // Assert
    });
  });
});
```

### Best Practices
- ✅ One assertion per test (when possible)
- ✅ Descriptive test names
- ✅ Arrange-Act-Assert pattern
- ✅ Clean up after tests
- ✅ Mock external dependencies
- ✅ Test error cases
- ✅ Test edge cases

---

## Coverage Goals

### Current Status
- Unit Tests: 0% (to be implemented)
- E2E Tests: 0% (to be implemented)

### Target Goals
- **Unit Tests**: 70% overall, 90%+ for critical paths
- **E2E Tests**: All critical user flows covered
- **Integration Tests**: All API endpoints tested

### Critical Paths (90%+ coverage required)
- Payment processing
- Webhook handling
- Order creation
- Refund processing
- Authentication

---

## Running Tests Locally

### Development Workflow
```bash
# Watch mode for unit tests (while developing)
pnpm test:unit --watch

# Run E2E tests before committing
pnpm test

# Run all tests
pnpm test:unit && pnpm test
```

### Pre-commit
Tests run automatically via Husky (if configured)

### Pre-push
Run full test suite before pushing

---

## Test Data Management

### Unit Tests
- Use mocks and stubs
- No real API calls
- Fast and isolated

### E2E Tests
- Use test Stripe account
- Use test Clerk accounts
- Use test database
- Clean up after tests

### Test Fixtures
```typescript
// tests/fixtures/stripe.ts
export const mockCheckoutSession = {
  id: "cs_test_123",
  // ...
};
```

---

## Debugging Tests

### Unit Tests
```bash
# Run with debug output
pnpm test:unit --reporter=verbose

# Run specific test
pnpm test:unit --grep "webhook"
```

### E2E Tests
```bash
# Run with UI
pnpm test:ui

# Run in headed mode
pnpm test --headed

# Debug mode
pnpm test --debug
```

---

## Continuous Improvement

### Metrics to Track
- Test coverage percentage
- Test execution time
- Flaky test rate
- Test failure rate

### Regular Reviews
- Review test coverage monthly
- Remove obsolete tests
- Add tests for new features
- Refactor slow tests

---

## Migration Path

### From Current to Full Testing

1. **✅ Current**: Manual testing + basic scripts
2. **🚀 Now**: Add unit tests (Vitest)
3. **⏳ Next**: Add E2E tests (Playwright)
4. **⏳ Future**: Full CI/CD integration

### Timeline
- **Week 1**: Set up Vitest, write unit tests
- **Week 2**: Set up Playwright, write E2E tests
- **Week 3**: Integrate into CI/CD
- **Ongoing**: Maintain and improve

---

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Best Practices](https://testingjavascript.com/)
- [CI/CD Best Practices](https://docs.github.com/en/actions)

---

**Last Updated**: Current Session  
**Status**: Phase 2 - Setting up unit and E2E tests

