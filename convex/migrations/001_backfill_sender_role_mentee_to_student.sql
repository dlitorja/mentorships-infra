-- Backfill workspaceMessages.senderRole from "mentee" to "student"
-- This migration addresses the schema change where senderRole union literal
-- changed from "mentee" to "student". Existing records need to be updated
-- so that queries checking for "student" will find these records.

UPDATE workspaceMessages
SET senderRole = 'student'
WHERE senderRole = 'mentee';