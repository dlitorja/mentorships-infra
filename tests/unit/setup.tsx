import React from "react";
import { vi } from "vitest";
import "@testing-library/jest-dom";
import { mockRouter } from "./mocks/router";

// Mock environment variables for tests
process.env.NEXT_PUBLIC_URL = "http://localhost:3000";
process.env.STRIPE_SECRET_KEY = "sk_test_FAKE_VALUE";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_FAKE_VALUE";
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_test_FAKE_VALUE";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres";

// Mock next/image so tests don't need image optimization
vi.mock("next/image", () => ({
  __esModule: true,
  default: function NextImage(props: any) {
    // eslint-disable-next-line @next/next/no-img-element
    return React.createElement("img", { ...props, src: props.src });
  },
}));

// Mock next/navigation so components can use useRouter without a real Next.js app
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock Clerk
export const mockClerkUser = {
  id: "user_test_123",
  emailAddresses: [{ emailAddress: "test@example.com" }],
  primaryEmailAddress: { emailAddress: "test@example.com" },
  externalAccounts: [],
};

vi.mock("@clerk/shared", () => ({
  useUser: () => ({
    user: mockClerkUser,
    isLoaded: true,
    isSignedIn: true,
  }),
  useAssertWrappedByClerkProvider: () => {},
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    user: mockClerkUser,
    isLoaded: true,
    isSignedIn: true,
  }),
  useAuth: () => ({
    userId: "user_test_123",
    isLoaded: true,
  }),
  ClerkProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Polyfills for DOM APIs not present in jsdom
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

global.ResizeObserver = MockResizeObserver as any;
global.IntersectionObserver = MockIntersectionObserver as any;

// Polyfill for URL.createObjectURL used by image preview flows
if (typeof global.URL.createObjectURL === "undefined") {
  global.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  global.URL.revokeObjectURL = vi.fn();
}

// Polyfill for scrollIntoView which is not implemented in jsdom
if (typeof Element.prototype.scrollIntoView === "undefined") {
  Element.prototype.scrollIntoView = vi.fn();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRouter.push.mockReset();
  mockRouter.replace.mockReset();
  mockRouter.refresh.mockReset();
});

export { mockRouter };
