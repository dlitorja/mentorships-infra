/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// ---------------------------------------------------------------------------
// Instructor read authorization
//
// The instructor document stores a long-lived Google OAuth credential
// (`googleRefreshToken`). Every read path that can hand back another
// instructor's document must strip it; only the owner's server routes
// (calendar select / disconnect) read it, through `getInstructorByUserId`.
// ---------------------------------------------------------------------------

const OWNER = "user_instructor_owner";
const OTHER = "user_student_reader";
const REFRESH_TOKEN = "1//refresh-token-secret";

async function seed(ctx: any) {
  const instructorId = await ctx.db.insert("instructors", {
    userId: OWNER,
    name: "Owner Instructor",
    email: "owner@example.com",
    slug: "owner-instructor",
    googleRefreshToken: REFRESH_TOKEN,
    googleCalendarId: "primary",
    isActive: true,
  });
  return instructorId;
}

test("getInstructorById: never returns googleRefreshToken to another signed-in user", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await t.run((ctx) => seed(ctx));

  const result = await t
    .withIdentity({ subject: OTHER })
    .query(api.instructors.getInstructorById, { id: instructorId });

  expect(result).not.toBeNull();
  expect(result).not.toHaveProperty("googleRefreshToken");
  expect(result?.name).toBe("Owner Instructor");
});

test("getInstructorById: never returns googleRefreshToken to the owner either", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await t.run((ctx) => seed(ctx));

  const result = await t
    .withIdentity({ subject: OWNER })
    .query(api.instructors.getInstructorById, { id: instructorId });

  expect(result).not.toBeNull();
  expect(result).not.toHaveProperty("googleRefreshToken");
});

test("getInstructorByEmail: never returns googleRefreshToken", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => seed(ctx));

  const result = await t
    .withIdentity({ subject: OTHER })
    .query(api.instructors.getInstructorByEmail, { email: "owner@example.com" });

  expect(result).not.toBeNull();
  expect(result).not.toHaveProperty("googleRefreshToken");
  expect(result?._id).toBeDefined();
});

test("getInstructorByUserIdExternal: never returns googleRefreshToken", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => seed(ctx));

  const result = await t
    .withIdentity({ subject: OWNER })
    .query(api.instructors.getInstructorByUserIdExternal, { userId: OWNER });

  expect(result).not.toBeNull();
  expect(result).not.toHaveProperty("googleRefreshToken");
});

test("getInstructorByUserId: strips googleRefreshToken for a different signed-in user", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => seed(ctx));

  // Mirrors the student onboarding flow, which reads the session pack's
  // instructor by userId while signed in as the student.
  const result = await t
    .withIdentity({ subject: OTHER })
    .query(api.instructors.getInstructorByUserId, { userId: OWNER });

  expect(result).not.toBeNull();
  expect(result).not.toHaveProperty("googleRefreshToken");
  expect(result?.name).toBe("Owner Instructor");
});

test("getInstructorByUserId: never returns googleRefreshToken, not even to the owner", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => seed(ctx));

  // The owner's server routes fetch the credential through the
  // CONVEX_HTTP_KEY-gated endpoint instead, so the public query must not
  // return it to anyone.
  const result = await t
    .withIdentity({ subject: OWNER })
    .query(api.instructors.getInstructorByUserId, { userId: OWNER });

  expect(result).not.toBeNull();
  expect(result).not.toHaveProperty("googleRefreshToken");
});

test("getInstructorGoogleCredentialsInternal: returns the credential for server callers", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await t.run((ctx) => seed(ctx));

  const credentials = await t.query(
    internal.instructors.getInstructorGoogleCredentialsInternal,
    { instructorId },
  );

  expect(credentials).toEqual({
    googleRefreshToken: REFRESH_TOKEN,
    googleCalendarId: "primary",
    googleAvailabilityCalendarIds: [],
  });
});

test("http /instructors/google-credentials: rejects a missing or wrong bearer", async () => {
  process.env.CONVEX_HTTP_KEY = "test-http-key";
  const t = convexTest(schema, modules);
  const instructorId = await t.run((ctx) => seed(ctx));

  const noAuth = await t.fetch("/instructors/google-credentials", {
    method: "POST",
    body: JSON.stringify({ instructorId }),
    headers: { "Content-Type": "application/json" },
  });
  expect(noAuth.status).toBe(401);

  const wrongAuth = await t.fetch("/instructors/google-credentials", {
    method: "POST",
    body: JSON.stringify({ instructorId }),
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer wrong-key",
    },
  });
  expect(wrongAuth.status).toBe(401);
});

test("http /instructors/google-credentials: returns the credential with the bearer", async () => {
  process.env.CONVEX_HTTP_KEY = "test-http-key";
  const t = convexTest(schema, modules);
  const instructorId = await t.run((ctx) => seed(ctx));

  const response = await t.fetch("/instructors/google-credentials", {
    method: "POST",
    body: JSON.stringify({ instructorId }),
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-http-key",
    },
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    googleRefreshToken: REFRESH_TOKEN,
    googleCalendarId: "primary",
    googleAvailabilityCalendarIds: [],
  });
});

test("getInstructorGoogleCredentialsInternal: returns null for a missing instructor", async () => {
  const t = convexTest(schema, modules);
  const instructorId = await t.run((ctx) => seed(ctx));
  await t.run((ctx) => ctx.db.delete(instructorId));

  const credentials = await t.query(
    internal.instructors.getInstructorGoogleCredentialsInternal,
    { instructorId },
  );

  expect(credentials).toBeNull();
});

test("getInstructorByUserId: returns null when unauthenticated", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => seed(ctx));

  const result = await t.query(api.instructors.getInstructorByUserId, { userId: OWNER });
  expect(result).toBeNull();
});
