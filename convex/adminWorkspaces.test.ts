/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

test("adminWorkspaces.getAllWorkspaces: returns paginated workspaces for admin", async () => {
  const t = convexTest({ schema, modules });

  const adminUserId = "user_admin_test";
  const studentUserId = "user_student_test";
  const instructorUserId = "user_instructor_test";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      clerkId: adminUserId,
      email: "admin@example.com",
      firstName: "Admin",
      lastName: "User",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "student@example.com",
      firstName: "Stu",
      lastName: "Dent",
      role: "student",
    });
    await ctx.db.insert("users", {
      userId: instructorUserId,
      clerkId: instructorUserId,
      email: "instructor@example.com",
      firstName: "Alice",
      lastName: "Artist",
      role: "instructor",
    });
    const instructorId = await ctx.db.insert("instructors", {
      userId: instructorUserId,
      email: "instructor@example.com",
      name: "Alice Artist",
    });
    await ctx.db.insert("workspaces", {
      name: "Workspace 1",
      ownerId: studentUserId,
      instructorId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    await ctx.db.insert("workspaces", {
      name: "Workspace 2",
      ownerId: studentUserId,
      isPublic: true,
      studentImageCount: 5,
      instructorImageCount: 0,
    });
  });

  // Admin can list all workspaces
  const result = await t
    .withIdentity({ subject: adminUserId })
    .query(api.adminWorkspaces.getAllWorkspaces, {
      paginationOpts: { numItems: 20, cursor: null },
    });

  expect(result.page.length).toBe(2);
  expect(result.page[0].owner?.email).toBe("student@example.com");
});

test("adminWorkspaces.getAllWorkspaces: excludes deleted workspaces without throwing", async () => {
  // Regression: previously a while loop called .paginate() a second
  // time when filtered page was short, which throws
  // "Only a single paginated query (`.paginate()`) is allowed per
  // function execution" on the deployed backend. See PR fix.
  //
  // With the DB-level `by_deletedAt` / `by_type_deletedAt` indexes,
  // deleted workspaces never appear in the page at all — so the
  // first page is guaranteed to contain only live rows, the cursor
  // never advances through empty pages, and we drain to completion
  // in one shot.
  const t = convexTest({ schema, modules });

  const adminUserId = "user_admin_test";
  const studentUserId = "user_student_test";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      clerkId: adminUserId,
      email: "admin@example.com",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "student@example.com",
      role: "student",
    });
    // Live workspaces first, then a large block of deleted ones.
    // The first page should return the live workspaces (filtered out
    // the deleted ones); the next page should contain only deleted
    // workspaces, which we filter out, and we should not throw.
    await ctx.db.insert("workspaces", {
      name: "Live 1",
      ownerId: studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
    await ctx.db.insert("workspaces", {
      name: "Live 2",
      ownerId: studentUserId,
      isPublic: true,
      studentImageCount: 5,
      instructorImageCount: 0,
    });
    for (let i = 0; i < 25; i++) {
      await ctx.db.insert("workspaces", {
        name: `Deleted ${i}`,
        ownerId: studentUserId,
        isPublic: false,
        studentImageCount: 0,
        instructorImageCount: 0,
        deletedAt: Date.now(),
      });
    }
  });

  // Drain all pages. The point of this test is that we can paginate
  // through a mix of live and deleted workspaces without throwing
  // the single-paginate error, AND that the first page is guaranteed
  // to contain live rows (no empty intermediate pages caused by JS-side
  // filtering of an index that didn't pre-exclude deletedAt).
  const seenNames: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  let firstPage: typeof seenNames = [];
  do {
    const next = await t
      .withIdentity({ subject: adminUserId })
      .query(api.adminWorkspaces.getAllWorkspaces, {
        paginationOpts: { numItems: 20, cursor },
      });
    const pageNames = next.page.map((w) => w.name);
    if (pages === 0) firstPage = pageNames;
    seenNames.push(...pageNames);
    cursor = next.continueCursor;
    pages++;
    if (next.isDone) break;
  } while (cursor && pages < 20);

  // The 2 live workspaces should appear across all pages.
  expect(seenNames.sort()).toEqual(["Live 1", "Live 2"]);
  // AND the first page must contain live rows — the index pre-filters
  // deletedAt at the DB level so admins never see "No workspaces found"
  // when live rows exist later in the dataset.
  expect(firstPage.sort()).toEqual(["Live 1", "Live 2"]);
  // With 2 live + 25 deleted, numItems=20 fits the 2 live rows on the
  // first page and the dataset is exhausted — no second page needed.
  expect(pages).toBe(1);
});

test("adminWorkspaces.getAllWorkspaces: filters by type", async () => {
  const t = convexTest({ schema, modules });

  const adminUserId = "user_admin_test";
  const studentUserId = "user_student_test";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: adminUserId,
      clerkId: adminUserId,
      email: "admin@example.com",
      role: "admin",
    });
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "student@example.com",
      role: "student",
    });
    await ctx.db.insert("workspaces", {
      name: "Mentorship 1",
      ownerId: studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "mentorship",
    });
    await ctx.db.insert("workspaces", {
      name: "Admin-Student 1",
      ownerId: studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      type: "admin_student",
    });
  });

  const mentorship = await t
    .withIdentity({ subject: adminUserId })
    .query(api.adminWorkspaces.getAllWorkspaces, {
      paginationOpts: { numItems: 20, cursor: null },
      type: "mentorship",
    });
  expect(mentorship.page.length).toBe(1);
  expect(mentorship.page[0].name).toBe("Mentorship 1");
  expect(mentorship.page[0].type).toBe("mentorship");

  const adminStudent = await t
    .withIdentity({ subject: adminUserId })
    .query(api.adminWorkspaces.getAllWorkspaces, {
      paginationOpts: { numItems: 20, cursor: null },
      type: "admin_student",
    });
  expect(adminStudent.page.length).toBe(1);
  expect(adminStudent.page[0].name).toBe("Admin-Student 1");
});

test("adminWorkspaces.getAllWorkspaces: rejects non-admin", async () => {
  const t = convexTest({ schema, modules });
  const studentUserId = "user_student_test";

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      userId: studentUserId,
      clerkId: studentUserId,
      email: "student@example.com",
      role: "student",
    });
    await ctx.db.insert("workspaces", {
      name: "W",
      ownerId: studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
    });
  });

  await expect(
    t
      .withIdentity({ subject: studentUserId })
      .query(api.adminWorkspaces.getAllWorkspaces, {
        paginationOpts: { numItems: 20, cursor: null },
      })
  ).rejects.toThrow("Admin access required");
});

test("adminWorkspaces.getAllWorkspaces: returns empty for anonymous", async () => {
  const t = convexTest({ schema, modules });

  const result = await t.query(api.adminWorkspaces.getAllWorkspaces, {
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(result.page).toEqual([]);
  expect(result.isDone).toBe(true);
});

test("getAllWorkspaces: handler has no loop that calls .paginate() (deployed-backend guard)", async () => {
  // convex-test does NOT enforce Convex's deployed-backend rule that
  // only one .paginate() call is allowed per query function execution,
  // so the behavioral regression test above passes even if a second
  // .paginate() is reintroduced inside a loop (the failure surfaces
  // only as a 500 on prod). This static guard walks the handler AST
  // and fails if any while/for/do statement contains a .paginate()
  // call anywhere in its body — the exact shape of the original bug
  // (a `while` loop re-paginating to backfill deletedAt-filtered rows).
  //
  // If you ever need a loop with .paginate() inside, drop this test
  // AND open a Linear issue explaining why Convex's single-paginate
  // rule has to be worked around.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const ts = await import("typescript");
  const file = path.join(import.meta.dirname, "adminWorkspaces.ts");
  const src = await fs.readFile(file, "utf8");

  const sourceFile = ts.default.createSourceFile(
    "adminWorkspaces.ts",
    src,
    ts.default.ScriptTarget.Latest,
    /*setParentNodes=*/ true,
    ts.default.ScriptKind.TS
  );

  // Locate the getAllWorkspaces variable declaration → query() call →
  // argument object literal → handler property → arrow function body.
  let handlerBody: ts.default.Node | undefined;
  function visit(node: ts.default.Node) {
    if (handlerBody) return;
    if (
      ts.default.isVariableDeclaration(node) &&
      ts.default.isIdentifier(node.name) &&
      node.name.text === "getAllWorkspaces"
    ) {
      const initializer = node.initializer;
      if (initializer && ts.default.isCallExpression(initializer)) {
        const arg0 = initializer.arguments[0];
        if (arg0 && ts.default.isObjectLiteralExpression(arg0)) {
          const handlerProp = arg0.properties.find(
            (p): p is ts.default.PropertyAssignment =>
              ts.default.isPropertyAssignment(p) &&
              ts.default.isIdentifier(p.name) &&
              p.name.text === "handler"
          );
          const handlerValue = handlerProp?.initializer;
          if (handlerValue && ts.default.isFunctionLike(handlerValue)) {
            handlerBody = handlerValue.body;
            return;
          }
        }
      }
    }
    ts.default.forEachChild(node, visit);
  }
  visit(sourceFile);

  expect(handlerBody, "could not locate getAllWorkspaces handler body").toBeDefined();

  // Find loops (while/for/do) in the handler and check if their body
  // contains any .paginate() call.
  function containsPaginateCall(node: ts.default.Node): boolean {
    if (
      ts.default.isCallExpression(node) &&
      ts.default.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "paginate"
    ) {
      return true;
    }
    return node.forEachChild((c) => containsPaginateCall(c)) ?? false;
  }

  const offending: string[] = [];
  function walk(node: ts.default.Node) {
    if (
      ts.default.isWhileStatement(node) ||
      ts.default.isForStatement(node) ||
      ts.default.isForInStatement(node) ||
      ts.default.isForOfStatement(node) ||
      ts.default.isDoStatement(node)
    ) {
      if (containsPaginateCall(node.statement)) {
        offending.push(ts.default.SyntaxKind[node.kind] ?? String(node.kind));
      }
    }
    ts.default.forEachChild(node, walk);
  }
  if (handlerBody) walk(handlerBody);

  expect(
    offending,
    `getAllWorkspaces handler contains a loop (${offending.join(", ")}) that calls .paginate(). Convex only allows one .paginate() per query function execution; a second call throws at runtime on the deployed backend.`
  ).toEqual([]);
});
