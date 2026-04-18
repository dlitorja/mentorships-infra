import { httpRouter } from "./_generated/server";
import {
  httpGetWorkspacesNeedingDeletion,
  httpGetWorkspacesForNotification,
  httpDeleteAllWorkspaceContent,
  httpCreateRetentionNotification,
  httpGetUserEmail,
  httpGetWorkspaceExportData,
  httpUpdateWorkspaceExportStatus,
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

http.route({
  path: "/workspace/export/data",
  method: "POST",
  handler: httpGetWorkspaceExportData,
});

http.route({
  path: "/workspace/export/update-status",
  method: "POST",
  handler: httpUpdateWorkspaceExportStatus,
});

export default http;
