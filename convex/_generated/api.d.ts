/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminWorkspaces from "../adminWorkspaces.js";
import type * as http from "../http.js";
import type * as instructors from "../instructors.js";
import type * as mutations_http from "../mutations/http.js";
import type * as orders from "../orders.js";
import type * as payments from "../payments.js";
import type * as products from "../products.js";
import type * as queries_http from "../queries/http.js";
import type * as seatReservations from "../seatReservations.js";
import type * as sessionPacks from "../sessionPacks.js";
import type * as sessions from "../sessions.js";
import type * as users from "../users.js";
import type * as waitlist from "../waitlist.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminWorkspaces: typeof adminWorkspaces;
  http: typeof http;
  instructors: typeof instructors;
  "mutations/http": typeof mutations_http;
  orders: typeof orders;
  payments: typeof payments;
  products: typeof products;
  "queries/http": typeof queries_http;
  seatReservations: typeof seatReservations;
  sessionPacks: typeof sessionPacks;
  sessions: typeof sessions;
  users: typeof users;
  waitlist: typeof waitlist;
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

export declare const components: {};
