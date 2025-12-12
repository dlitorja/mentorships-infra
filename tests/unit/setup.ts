import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock environment variables for tests
process.env.NEXT_PUBLIC_URL = "http://localhost:3000";
process.env.STRIPE_SECRET_KEY = "sk_test_mock_key";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_mock_secret";
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_mock_key";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Clerk
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: {
      id: "user_test_123",
      emailAddresses: [{ emailAddress: "test@example.com" }],
    },
    isLoaded: true,
  }),
  useAuth: () => ({
    userId: "user_test_123",
    isLoaded: true,
  }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
}));

