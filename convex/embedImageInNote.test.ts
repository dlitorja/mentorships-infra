/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * PR workspace-storage-3c surfaced a Server Error on
 * `workspaces:embedImageInNote` in production. The mutation's
 * explicit `throw new Error("…")` paths cover every category
 * the mutation can reject on, but there was no automated
 * coverage to prove it — every refactor since the cutover had
 * to be verified by hand against a real B2 upload. This file
 * pins the contract so a future regression in the auth,
 * ledger-gate, content-type, or cap branches is caught at
 * `pnpm test:convex` time instead of in a Clerk-authenticated
 * browser session.
 *
 * The mutation is B2-only after PR 3c — the legacy
 * Convex-storage path was retired. Tests seed the
 * `fileUploads` ledger directly so the assertions run without
 * the B2 mint/confirm round-trip.
 */

async function seedWorkspace(t: ReturnType<typeof convexTest>, args: {
  studentUserId: string;
  instructorUserId: string;
  type?: "mentorship" | "admin_student" | "admin_instructor";
  instructorImageCount?: number;
  activeImageRows?: number;
}): Promise<{ workspaceId: string; noteId: string; b2Key: string }> {
  let workspaceId = "";
  let noteId = "";
  const b2Key = `workspaces/test/file_${Math.random().toString(36).slice(2)}.png`;
  await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: args.instructorUserId,
    });
    await ctx.db.insert("users", {
      userId: args.studentUserId,
      clerkId: args.studentUserId,
      email: `${args.studentUserId}@example.com`,
      role: "student",
    });
    workspaceId = await ctx.db.insert("workspaces", {
      name: "Embed Test",
      ownerId: args.studentUserId,
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: args.instructorImageCount ?? 0,
      instructorId: instructorId as any,
      type: args.type ?? "mentorship",
    });
    noteId = await ctx.db.insert("workspaceNotes", {
      workspaceId: workspaceId as any,
      title: "Test note",
      content: "",
      createdBy: args.instructorUserId,
      updatedAt: Date.now(),
    });
    // Seed `activeImageRows` already-counted images so the
    // cap gate can be exercised without inserting 250 rows.
    for (let i = 0; i < (args.activeImageRows ?? 0); i++) {
      await ctx.db.insert("workspaceImages", {
        workspaceId: workspaceId as any,
        imageUrl: "",
        createdBy: args.instructorUserId,
      });
    }
    const now = Date.now();
    await ctx.db.insert("fileUploads", {
      workspaceId: workspaceId as any,
      b2Key,
      uploaderId: args.instructorUserId,
      uploadedAt: now,
      contentType: "image/png",
      size: 1024,
      completedAt: now,
    });
  });
  return { workspaceId, noteId, b2Key };
}

test("embedImageInNote: instructor happy path inserts workspaceImages row, patches counter, returns b2Key", async () => {
  const t = convexTest({ schema, modules });
  const seed = await seedWorkspace(t, {
    studentUserId: "user_student_1",
    instructorUserId: "user_instructor_1",
    instructorImageCount: 3,
  });
  const instructorT = t.withIdentity({ subject: "user_instructor_1" });

  const returnedKey = await instructorT.mutation(api.workspaces.embedImageInNote, {
    noteId: seed.noteId as any,
    b2Key: seed.b2Key,
  });
  expect(returnedKey).toBe(seed.b2Key);

  // Workspace counter bumps by exactly one — PR workspace-storage-3c
  // contract: the pre-call count is whatever the workspace stored;
  // post-call count is +1. `countActiveWorkspaceImages` is reserved
  // for the admin cap path (which does its own scan).
  const workspace = await t.run(async (ctx) => ctx.db.get(seed.workspaceId as any));
  expect(workspace?.instructorImageCount).toBe(4);

  // A `workspaceImages` row was inserted with `imageUrl: ""` and
  // the `b2Key` so the UI can resolve the URL on render.
  const images = await t.run(async (ctx) =>
    ctx.db.query("workspaceImages").withIndex("by_b2Key", (q) => q.eq("b2Key", seed.b2Key)).collect()
  );
  expect(images).toHaveLength(1);
  expect(images[0]).toMatchObject({
    workspaceId: seed.workspaceId,
    imageUrl: "",
    b2Key: seed.b2Key,
    createdBy: "user_instructor_1",
  });

  // The note's `imageUrl` is patched to "" — the source of truth
  // is the new `workspaceImages` row + `b2Key`, not the note's
  // legacy field. PR 3c narrowed the note's `imageUrl` to a
  // placeholder so apps/web legacy readers still see the row as
  // updated.
  const note = await t.run(async (ctx) => ctx.db.get(seed.noteId as any));
  expect(note?.imageUrl).toBe("");
  expect(typeof note?.updatedAt).toBe("number");
});

test("embedImageInNote: rejects unauthenticated callers (Server Error -> Unauthorized)", async () => {
  const t = convexTest({ schema, modules });
  const seed = await seedWorkspace(t, {
    studentUserId: "user_student_1",
    instructorUserId: "user_instructor_1",
  });
  // No `withIdentity` — mutation runs as anonymous.
  await expect(
    t.mutation(api.workspaces.embedImageInNote, {
      noteId: seed.noteId as any,
      b2Key: seed.b2Key,
    })
  ).rejects.toThrow(/Unauthorized/);
});

test("embedImageInNote: rejects student callers with role gate message", async () => {
  const t = convexTest({ schema, modules });
  const seed = await seedWorkspace(t, {
    studentUserId: "user_student_1",
    instructorUserId: "user_instructor_1",
  });
  const studentT = t.withIdentity({ subject: "user_student_1" });
  await expect(
    studentT.mutation(api.workspaces.embedImageInNote, {
      noteId: seed.noteId as any,
      b2Key: seed.b2Key,
    })
  ).rejects.toThrow(/instructors and admins/);
});

test("embedImageInNote: rejects unknown b2Key (ledger-gate)", async () => {
  const t = convexTest({ schema, modules });
  const seed = await seedWorkspace(t, {
    studentUserId: "user_student_1",
    instructorUserId: "user_instructor_1",
  });
  const instructorT = t.withIdentity({ subject: "user_instructor_1" });
  await expect(
    instructorT.mutation(api.workspaces.embedImageInNote, {
      noteId: seed.noteId as any,
      b2Key: "workspaces/test/file_unknown.png",
    })
  ).rejects.toThrow(/not bound to a known upload/);
});

test("embedImageInNote: rejects b2Key whose ledger row is not yet completed", async () => {
  const t = convexTest({ schema, modules });
  const { workspaceId, noteId } = await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_1",
    });
    const ws = await ctx.db.insert("workspaces", {
      name: "Embed Test",
      ownerId: "user_student_1",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      instructorId: instructorId as any,
    });
    const n = await ctx.db.insert("workspaceNotes", {
      workspaceId: ws,
      title: "Note",
      content: "",
      createdBy: "user_instructor_1",
      updatedAt: Date.now(),
    });
    // Reserve a ledger row but never confirm it.
    await ctx.db.insert("fileUploads", {
      workspaceId: ws,
      b2Key: "workspaces/test/file_pending.png",
      uploaderId: "user_instructor_1",
      uploadedAt: Date.now(),
      contentType: "image/png",
      size: 1024,
    });
    return { workspaceId: ws, noteId: n };
  });
  const instructorT = t.withIdentity({ subject: "user_instructor_1" });
  await expect(
    instructorT.mutation(api.workspaces.embedImageInNote, {
      noteId: noteId as any,
      b2Key: "workspaces/test/file_pending.png",
    })
  ).rejects.toThrow(/has not been confirmed/);
  // workspaceId is unused here but the t.run scope requires it
  // to be declared at the top level.
  expect(workspaceId).toBeTruthy();
});

test("embedImageInNote: rejects non-image content type", async () => {
  const t = convexTest({ schema, modules });
  const b2Key = "workspaces/test/file_pdf.png";
  await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_1",
    });
    const ws = await ctx.db.insert("workspaces", {
      name: "Embed Test",
      ownerId: "user_student_1",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      instructorId: instructorId as any,
    });
    const noteId = await ctx.db.insert("workspaceNotes", {
      workspaceId: ws,
      title: "Note",
      content: "",
      createdBy: "user_instructor_1",
      updatedAt: Date.now(),
    });
    await ctx.db.insert("fileUploads", {
      workspaceId: ws,
      b2Key,
      uploaderId: "user_instructor_1",
      uploadedAt: Date.now(),
      contentType: "application/pdf",
      size: 1024,
      completedAt: Date.now(),
    });
  });
  const noteId = await t.run(async (ctx) => {
    const notes = await ctx.db.query("workspaceNotes").collect();
    return notes[0]._id;
  });
  const instructorT = t.withIdentity({ subject: "user_instructor_1" });
  await expect(
    instructorT.mutation(api.workspaces.embedImageInNote, {
      noteId: noteId as any,
      b2Key,
    })
  ).rejects.toThrow(/Only image files can be embedded/);
});

test("embedImageInNote: rejects when instructor image cap reached", async () => {
  const t = convexTest({ schema, modules });
  // Instructor cap is 250. Seed the workspace already at the
  // cap so the next embed would push it over.
  const seed = await seedWorkspace(t, {
    studentUserId: "user_student_1",
    instructorUserId: "user_instructor_1",
    instructorImageCount: 250,
  });
  const instructorT = t.withIdentity({ subject: "user_instructor_1" });
  await expect(
    instructorT.mutation(api.workspaces.embedImageInNote, {
      noteId: seed.noteId as any,
      b2Key: seed.b2Key,
    })
  ).rejects.toThrow(/Image limit reached \(250 images allowed\)/);
});

test("embedImageInNote: rejects b2Key owned by a different caller", async () => {
  const t = convexTest({ schema, modules });
  const b2Key = "workspaces/test/file_other.png";
  await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_1",
    });
    const ws = await ctx.db.insert("workspaces", {
      name: "Embed Test",
      ownerId: "user_student_1",
      isPublic: false,
      studentImageCount: 0,
      instructorImageCount: 0,
      instructorId: instructorId as any,
    });
    await ctx.db.insert("workspaceNotes", {
      workspaceId: ws,
      title: "Note",
      content: "",
      createdBy: "user_instructor_1",
      updatedAt: Date.now(),
    });
    // Ledger row belongs to instructor_1 — instructor_2 cannot
    // bind to it.
    await ctx.db.insert("fileUploads", {
      workspaceId: ws,
      b2Key,
      uploaderId: "user_instructor_1",
      uploadedAt: Date.now(),
      contentType: "image/png",
      size: 1024,
      completedAt: Date.now(),
    });
  });
  const noteId = await t.run(async (ctx) => {
    const notes = await ctx.db.query("workspaceNotes").collect();
    return notes[0]._id;
  });
  const otherInstructorT = t.withIdentity({ subject: "user_instructor_2" });
  // Seed a second instructor so `getWorkspaceRole` recognises
  // them as an instructor for this workspace.
  await t.run(async (ctx) => {
    const instructorId = await ctx.db.insert("instructors", {
      userId: "user_instructor_2",
    });
    const ws = await ctx.db.query("workspaces").collect();
    await ctx.db.patch(ws[0]._id, { instructorId: instructorId as any });
  });
  await expect(
    otherInstructorT.mutation(api.workspaces.embedImageInNote, {
      noteId: noteId as any,
      b2Key,
    })
  ).rejects.toThrow(/not owned by the caller/);
});
