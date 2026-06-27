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