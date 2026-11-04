/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import * as userIdentities from "./userIdentities";
import * as adminWorkspaces from "./adminWorkspaces";

const modules = import.meta.glob("./**/*.ts");

test("user identity server-only writers are internal and the public upsert is gone", () => {
  const internal = userIdentities.upsertUserIdentityInternal as {
    isInternal?: boolean;
    isPublic?: boolean;
  };
  expect(internal.isInternal).toBe(true);
  expect(internal.isPublic).not.toBe(true);

  expect("upsertUserIdentity" in userIdentities).toBe(false);

  const link = adminWorkspaces.linkWorkspaceToSessionPack as {
    isInternal?: boolean;
    isPublic?: boolean;
  };
  expect(link.isInternal).toBe(true);
  expect(link.isPublic).not.toBe(true);
});

test("linkMyDiscordIdentity derives the user id from the caller", async () => {
  const t = convexTest(schema, modules);

  await expect(
    t.mutation(api.userIdentities.linkMyDiscordIdentity, {
      providerUserId: "discord_anon",
    })
  ).rejects.toThrow("Unauthorized");

  const owner = "user_identity_owner";
  const first = await t
    .withIdentity({ subject: owner })
    .mutation(api.userIdentities.linkMyDiscordIdentity, {
      providerUserId: "discord_owner",
    });
  expect(first.userId).toBe(owner);

  const second = await t
    .withIdentity({ subject: owner })
    .mutation(api.userIdentities.linkMyDiscordIdentity, {
      providerUserId: "discord_owner",
    });
  expect(second._id).toBe(first._id);
});
