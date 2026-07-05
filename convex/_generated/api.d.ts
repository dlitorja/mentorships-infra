/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as adminWorkspaces from "../adminWorkspaces.js";
import type * as bookings from "../bookings.js";
import type * as cleanup from "../cleanup.js";
import type * as clerkDeletion from "../clerkDeletion.js";
import type * as contacts from "../contacts.js";
import type * as crons from "../crons.js";
import type * as dailyRecordingActions from "../dailyRecordingActions.js";
import type * as discordActionQueue from "../discordActionQueue.js";
import type * as hdInvitations from "../hdInvitations.js";
import type * as http from "../http.js";
import type * as instructorResources from "../instructorResources.js";
import type * as instructorUploads from "../instructorUploads.js";
import type * as instructors from "../instructors.js";
import type * as legacyMappings from "../legacyMappings.js";
import type * as migrationQueries from "../migrationQueries.js";
import type * as migrations from "../migrations.js";
import type * as monthlyStorageCosts from "../monthlyStorageCosts.js";
import type * as mutations_http from "../mutations/http.js";
import type * as notifications from "../notifications.js";
import type * as orders from "../orders.js";
import type * as payments from "../payments.js";
import type * as products from "../products.js";
import type * as queries_http from "../queries/http.js";
import type * as seatReservations from "../seatReservations.js";
import type * as seed from "../seed.js";
import type * as sessionPacks from "../sessionPacks.js";
import type * as sessions from "../sessions.js";
import type * as studentInvitations from "../studentInvitations.js";
import type * as studentOnboarding from "../studentOnboarding.js";
import type * as studentSessionCounts from "../studentSessionCounts.js";
import type * as userIdentities from "../userIdentities.js";
import type * as users from "../users.js";
import type * as users_actions from "../users_actions.js";
import type * as videoEditorAssignments from "../videoEditorAssignments.js";
import type * as waitlist from "../waitlist.js";
import type * as workspaceActions from "../workspaceActions.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  adminWorkspaces: typeof adminWorkspaces;
  bookings: typeof bookings;
  cleanup: typeof cleanup;
  clerkDeletion: typeof clerkDeletion;
  contacts: typeof contacts;
  crons: typeof crons;
  dailyRecordingActions: typeof dailyRecordingActions;
  discordActionQueue: typeof discordActionQueue;
  hdInvitations: typeof hdInvitations;
  http: typeof http;
  instructorResources: typeof instructorResources;
  instructorUploads: typeof instructorUploads;
  instructors: typeof instructors;
  legacyMappings: typeof legacyMappings;
  migrationQueries: typeof migrationQueries;
  migrations: typeof migrations;
  monthlyStorageCosts: typeof monthlyStorageCosts;
  "mutations/http": typeof mutations_http;
  notifications: typeof notifications;
  orders: typeof orders;
  payments: typeof payments;
  products: typeof products;
  "queries/http": typeof queries_http;
  seatReservations: typeof seatReservations;
  seed: typeof seed;
  sessionPacks: typeof sessionPacks;
  sessions: typeof sessions;
  studentInvitations: typeof studentInvitations;
  studentOnboarding: typeof studentOnboarding;
  studentSessionCounts: typeof studentSessionCounts;
  userIdentities: typeof userIdentities;
  users: typeof users;
  users_actions: typeof users_actions;
  videoEditorAssignments: typeof videoEditorAssignments;
  waitlist: typeof waitlist;
  workspaceActions: typeof workspaceActions;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
