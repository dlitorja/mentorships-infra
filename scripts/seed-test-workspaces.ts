/**
 * Seed script to create test workspaces for testing
 *
 * Usage (from project root):
 *   npx tsx scripts/seed-test-workspaces.ts
 */

import { spawn } from "child_process";

const TEST_USERS = {
  instructor: {
    userId: "user_3FeL3ri6RljSpv3HDKxmWfnVPi7",
    email: "test-instructor-workspace@example.com",
    firstName: "Test",
    lastName: "Instructor",
    role: "instructor" as const,
  },
  student: {
    userId: "user_3FeL49FTyXqF4B28s2kQMqwwwfb",
    email: "test-student-workspace@example.com",
    firstName: "Test",
    lastName: "Student",
    role: "student" as const,
  },
};

// PR #5: deterministic video room name for the seeded session. The
// Daily stub (`tests/e2e/helpers/daily-stub.ts`) intercepts any
// `createCallObject` / `join` call so the room name doesn't need to
// match a real Daily room — it just needs to be unique per seed run.
const SEED_VIDEO_ROOM_NAME = `seed-room-${Date.now()}`;

function runConvexMutation(functionName: string, args: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const argsJson = JSON.stringify(args);
    const child = spawn("npx", [
      "convex",
      "run",
      functionName,
      argsJson,
      "--typecheck", "disable"
    ], {
      cwd: process.cwd(),
      shell: false
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${functionName} failed: ${stderr || stdout}`));
        return;
      }
      
      const trimmed = stdout.trim();
      
      // Handle plain string ID (e.g., "jd731syqgqrqbytxpfdqv1qhn189a888")
      if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
        try {
          resolve(JSON.parse(trimmed));
          return;
        } catch {
          // Continue to try JSON parsing
        }
      }
      
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          resolve(JSON.parse(jsonMatch[0]));
        } else {
          resolve({ success: true, raw: trimmed });
        }
      } catch (e) {
        resolve({ success: true, raw: stdout });
      }
    });
  });
}

async function createUser(user: typeof TEST_USERS.instructor): Promise<string> {
  console.log(`  Creating user: ${user.email}...`);
  try {
    const result = await runConvexMutation("users:createUser", {
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    });
    console.log(`  ✓ User created`);
    return result._id || result;
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint") || e.message?.includes("already exists")) {
      console.log(`  ⏭️  User already exists, skipping`);
      return "existing";
    }
    throw e;
  }
}

async function createInstructor(userId: string, email: string, name: string): Promise<string> {
  console.log(`  Creating instructor: ${email}...`);
  const slug = `test-instructor-${Date.now()}`;
  try {
    const result = await runConvexMutation("instructors:createInstructor", {
      userId,
      name,
      slug,
      email: email.toLowerCase(),
      isActive: true,
      isNew: true,
    });
    console.log(`  ✓ Instructor created`);
    if (typeof result === "string") return result;
    return result._id || result.instructorId || result;
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint") || e.message?.includes("already exists")) {
      console.log(`  ⏭️  Instructor already exists, skipping`);
      return "existing";
    }
    throw e;
  }
}

async function createMentorshipWorkspace(ownerId: string, instructorId: string, name: string): Promise<string> {
  console.log(`  Creating mentorship workspace for ${ownerId}...`);
  try {
    const result = await runConvexMutation("workspaces:createWorkspace", {
      name,
      description: "Workspace for testing workspace features",
      ownerId,
      instructorId,
      isPublic: false,
    });
    console.log(`  ✓ Workspace created`);
    if (typeof result === "string") return result;
    return result._id || result;
  } catch (e: any) {
    if (e.message?.includes("already exists") || e.message?.includes("UNIQUE constraint")) {
      console.log(`  ⏭️  Workspace already exists, skipping`);
      return "existing";
    }
    throw e;
  }
}

// PR #5: seed a session pack so `seedActiveSessionForE2E` has a
// `sessionPackId` to attach. The pack is what `getCurrentOrUpcomingSessionForWorkspace`
// reads to find a session — without one, no session row would be
// visible to the E2E spec.
async function createSeedSessionPack(
  userId: string,
  instructorId: string,
): Promise<string> {
  console.log(`  Creating seed session pack for ${userId}...`);
  try {
    const result = await runConvexMutation("sessionPacks:createSessionPack", {
      userId,
      instructorId,
      totalSessions: 4,
      remainingSessions: 4,
    });
    console.log(`  ✓ Session pack created`);
    if (typeof result === "string") return result;
    return result._id || result;
  } catch (e: any) {
    if (e.message?.includes("already exists") || e.message?.includes("UNIQUE constraint")) {
      console.log(`  ⏭️  Session pack already exists, skipping`);
      return "existing";
    }
    throw e;
  }
}

// PR #5: seed an active session row so the E2E spec sees
// `useCurrentOrUpcomingSessionForWorkspace` returning
// `status === "active"`. Calls the test-only mutation
// `instructorResources:seedActiveSessionForE2E` (requires
// `confirmSeed: true`) which inserts a session with
// `callStartedAt` already populated — bypassing the join-window
// check that `markCallStarted` (sessions.ts:1861) enforces for
// real callers.
async function createActiveSession(
  instructorId: string,
  studentId: string,
  sessionPackId: string,
): Promise<string> {
  console.log(`  Creating active session for ${studentId}...`);
  try {
    const result = await runConvexMutation(
      "instructorResources:seedActiveSessionForE2E",
      {
        instructorId,
        studentId,
        sessionPackId,
        videoRoomName: SEED_VIDEO_ROOM_NAME,
        confirmSeed: true,
      },
    );
    console.log(`  ✓ Active session created`);
    if (typeof result === "string") return result;
    return result._id || result;
  } catch (e: any) {
    if (e.message?.includes("already exists") || e.message?.includes("UNIQUE constraint")) {
      console.log(`  ⏭️  Active session already exists, skipping`);
      return "existing";
    }
    throw e;
  }
}

async function main() {
  console.log("=== Creating Test Workspaces ===\n");

  console.log("--- Creating Instructor User ---");
  await createUser(TEST_USERS.instructor);

  console.log("\n--- Creating Student User ---");
  await createUser(TEST_USERS.student);

  console.log("\n--- Creating Instructor Record ---");
  const instructorId = await createInstructor(
    TEST_USERS.instructor.userId,
    TEST_USERS.instructor.email,
    `${TEST_USERS.instructor.firstName} ${TEST_USERS.instructor.lastName}`
  );

  console.log("\n--- Creating Workspace ---");
  if (instructorId !== "existing" && instructorId !== "test-instructor-") {
    await createMentorshipWorkspace(
      TEST_USERS.student.userId,
      instructorId,
      "Test Student-Instructor Workspace"
    );
    console.log("\n  Workspace links instructor and student for testing.");

    // PR #5: seed a session pack + active session so the
    // "Shared during current call" subpanel has data to render.
    // The spec needs `useCurrentOrUpcomingSessionForWorkspace` to
    // return an active session for the workspace; without these
    // two extra entities, the subpanel never renders regardless
    // of the Daily stub.
    console.log("\n--- Creating Seed Session Pack ---");
    const sessionPackId = await createSeedSessionPack(
      TEST_USERS.student.userId,
      instructorId,
    );

    if (sessionPackId !== "existing") {
      console.log("\n--- Creating Active Session ---");
      await createActiveSession(
        instructorId,
        TEST_USERS.student.userId,
        sessionPackId,
      );
      console.log(`  Room name: ${SEED_VIDEO_ROOM_NAME}`);
    } else {
      console.log("  ⏭️  Skipping active session — session pack exists");
    }
  } else {
    console.log("  ⏭️  Skipping - need valid instructor ID");
  }

  console.log("\n=== Test Workspaces Setup Complete ===");
  console.log("\nTest accounts created:");
  console.log(`  Instructor: ${TEST_USERS.instructor.email}`);
  console.log(`  Student: ${TEST_USERS.student.email}`);
  console.log("\nSign in at localhost:3000/sign-in to test workspace features.");
}

main().catch(console.error);