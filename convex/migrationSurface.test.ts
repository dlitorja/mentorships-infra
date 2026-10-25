/// <reference types="vite/client" />
import { expect, test } from "vitest";
import * as contacts from "./contacts";
import * as instructorUploads from "./instructorUploads";
import * as instructors from "./instructors";
import * as monthlyStorageCosts from "./monthlyStorageCosts";
import * as payments from "./payments";
import * as products from "./products";
import * as seatReservations from "./seatReservations";
import * as seed from "./seed";
import * as sessionPacks from "./sessionPacks";
import * as studentInvitations from "./studentInvitations";
import * as studentSessionCounts from "./studentSessionCounts";
import * as userIdentities from "./userIdentities";
import * as users from "./users";
import * as videoEditorAssignments from "./videoEditorAssignments";

/**
 * Security sweep F2/F3/F4 regression guard.
 *
 * One-time migration helpers must not be part of the public Convex
 * surface. A public `mutation` is callable by anyone holding the
 * deployment URL (`NEXT_PUBLIC_CONVEX_URL`), and these helpers write or
 * overwrite domain rows with no auth gate in the handler.
 *
 * Type-level enforcement exists already: `api.<module>.<fn>` stops
 * typechecking once an export is `internalMutation`. This test pins the
 * invariant at runtime as well, using the registration metadata Convex
 * sets on every function (`isInternal` for internal, `isPublic` for
 * public), so a future edit cannot silently re-expose one.
 */

type Visibility = { isInternal?: boolean; isPublic?: boolean };

const INTERNAL_ONLY: ReadonlyArray<readonly [string, string, Visibility]> = [
  ["users", "migrateUser", users.migrateUser as Visibility],
  [
    "studentInvitations",
    "migrateInvitation",
    studentInvitations.migrateInvitation as Visibility,
  ],
  ["userIdentities", "migrateUserIdentity", userIdentities.migrateUserIdentity as Visibility],
  ["seed", "seedInstructorsWithProducts", seed.seedInstructorsWithProducts as Visibility],
  [
    "monthlyStorageCosts",
    "migrateMonthlyStorageCost",
    monthlyStorageCosts.migrateMonthlyStorageCost as Visibility,
  ],
  ["products", "migrateProduct", products.migrateProduct as Visibility],
  ["sessionPacks", "migrateSessionPack", sessionPacks.migrateSessionPack as Visibility],
  [
    "videoEditorAssignments",
    "migrateVideoEditorAssignment",
    videoEditorAssignments.migrateVideoEditorAssignment as Visibility,
  ],
  ["instructors", "migrateInstructor", instructors.migrateInstructor as Visibility],
  ["payments", "migratePayment", payments.migratePayment as Visibility],
  [
    "instructorUploads",
    "migrateInstructorUpload",
    instructorUploads.migrateInstructorUpload as Visibility,
  ],
  ["contacts", "migrateContact", contacts.migrateContact as Visibility],
  [
    "studentSessionCounts",
    "migrateSessionCount",
    studentSessionCounts.migrateSessionCount as Visibility,
  ],
  [
    "seatReservations",
    "migrateSeatReservation",
    seatReservations.migrateSeatReservation as Visibility,
  ],
];

test.each(INTERNAL_ONLY)("%s.%s is internal-only", (_module, _name, registered) => {
  expect(registered.isInternal).toBe(true);
  expect(registered.isPublic).toBeUndefined();
});
