// PR workspace-storage-3c (narrow): the
// `generateWorkspaceImageUploadUrl` action is removed. All
// workspace uploads now go through
// `workspaceStorage.generateWorkspaceUploadUrl` (the B2 path)
// which the cutover flag (`WORKSPACE_STORAGE_USE_B2`) gates
// atomically. After PR 3c ships, no client path reads this
// action — the Vercel bundle drops it via tree-shaking, and
// this file is left empty for a future PR to delete outright.
export {};
