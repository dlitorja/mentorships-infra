/**
 * Seed script to create test workspaces in PRODUCTION Convex
 * 
 * Usage (from project root):
 *   npx tsx scripts/seed-test-workspaces-production.ts
 */

import { spawn } from "child_process";

const CONVEX_DEPLOYMENT = "prod:fine-bulldog-260";

const TEST_INSTRUCTOR = {
  userId: "user_3FeL3ri6RljSpv3HDKxmWfnVPi7",
  email: "test-instructor-workspace@example.com",
  firstName: "Test",
  lastName: "Instructor",
  role: "instructor",
};

const TEST_STUDENT = {
  userId: "user_3FeL49FTyXqF4B28s2kQMqwwwfb",
  email: "test-student-workspace@example.com",
  firstName: "Test",
  lastName: "Student",
  role: "student",
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
      shell: false,
      env: { ...process.env, CONVEX_DEPLOYMENT }
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
          // Continue
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

async function createUser(user: typeof TEST_INSTRUCTOR): Promise<void> {
  console.log(`  Creating user: ${user.email}...`);
  try {
    await runConvexMutation("users:createUser", {
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    });
    console.log(`  ✓ User created`);
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint") || e.message?.includes("already exists")) {
      console.log(`  ⏭️  User already exists, skipping`);
    } else {
      throw e;
    }
  }
}

async function createInstructor(): Promise<string> {
  console.log(`  Creating instructor record...`);
  const slug = `test-instructor-workspace`;
  try {
    const result = await runConvexMutation("instructors:createInstructor", {
      userId: TEST_INSTRUCTOR.userId,
      name: `${TEST_INSTRUCTOR.firstName} ${TEST_INSTRUCTOR.lastName}`,
      slug,
      email: TEST_INSTRUCTOR.email.toLowerCase(),
      isActive: true,
      isNew: true,
    });
    console.log(`  ✓ Instructor created`);
    if (typeof result === "string") return result;
    return result._id || result;
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint") || e.message?.includes("already exists") || e.message?.includes("Slug already exists")) {
      console.log(`  ⏭️  Instructor already exists, skipping`);
      return "existing";
    }
    throw e;
  }
}

async function createWorkspace(instructorId: string): Promise<void> {
  console.log(`  Creating mentorship workspace...`);
  try {
    await runConvexMutation("workspaces:createWorkspace", {
      name: "Test Student-Instructor Workspace",
      description: "Workspace for testing workspace features",
      ownerId: TEST_STUDENT.userId,
      instructorId,
      isPublic: false,
    });
    console.log(`  ✓ Workspace created`);
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint") || e.message?.includes("already exists")) {
      console.log(`  ⏭️  Workspace already exists, skipping`);
    } else {
      throw e;
    }
  }
}

async function main() {
  console.log("=== Creating Test Workspaces in PRODUCTION ===\n");

  console.log("--- Creating Instructor User ---");
  await createUser(TEST_INSTRUCTOR);

  console.log("\n--- Creating Student User ---");
  await createUser(TEST_STUDENT);

  console.log("\n--- Creating Instructor Record ---");
  const instructorId = await createInstructor();

  console.log("\n--- Creating Workspace ---");
  if (instructorId && instructorId !== "existing") {
    await createWorkspace(instructorId);
  } else {
    console.log("  ⏭️  Skipping - instructor not created");
  }

  console.log("\n=== Production Setup Complete ===");
  console.log("\nTest accounts created in PRODUCTION Clerk:");
  console.log(`  Instructor: ${TEST_INSTRUCTOR.email}`);
  console.log(`  Student: ${TEST_STUDENT.email}`);
  console.log("\n✅ Test data inserted into PRODUCTION Convex!");
}

main().catch(console.error);