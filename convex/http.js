import { httpRouter } from "./_generated/server";
import {
  httpGetWorkspacesNeedingDeletion,
  httpGetWorkspacesForNotification,
  httpDeleteAllWorkspaceContent,
  httpCreateRetentionNotification,
  httpGetUserEmail,
} from "./http";

const http = httpRouter();

http.route({
  path: "/workspace/retention/delete",
  method: "POST",
  handler: httpDeleteAllWorkspaceContent,
});

http.route({
  path: "/workspace/retention/needing-deletion",
  method: "GET",
  handler: httpGetWorkspacesNeedingDeletion,
});

http.route({
  path: "/workspace/retention/for-notification",
  method: "GET",
  handler: httpGetWorkspacesForNotification,
});

http.route({
  path: "/workspace/retention/notify",
  method: "POST",
  handler: httpCreateRetentionNotification,
});

http.route({
  path: "/users/email",
  method: "POST",
  handler: httpGetUserEmail,
});

export default http;
