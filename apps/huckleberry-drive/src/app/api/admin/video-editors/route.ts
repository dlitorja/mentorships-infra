import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireAdmin, UnauthorizedError, ForbiddenError } from "@/lib/auth";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();
    const { getToken } = await auth();
    const token = await getToken({ template: "convex" }) ?? undefined;

    const editors = await fetchQuery(
      api.users.getUsersByRole,
      { role: "video_editor" },
      { token }
    );

    const instructorIds = new Set<string>();
    const editorAssignments = await Promise.all(
      editors.map(async (editor) => {
        const assignments = await fetchQuery(
          api.videoEditorAssignments.getVideoEditorAssignmentsWithStorage,
          { videoEditorId: editor.userId },
          { token }
        );

        for (const assignment of assignments) {
          instructorIds.add(assignment.assignment.instructorId);
        }

        return { editor, assignments };
      })
    );

    const instructors =
      instructorIds.size > 0
        ? await fetchQuery(
            api.users.getUsersByUserIds,
            { userIds: Array.from(instructorIds) },
            { token }
          )
        : [];

    const instructorById = new Map(instructors.map((i) => [i.userId, i]));

    const response = editorAssignments.map(({ editor, assignments }) => ({
      editor,
      assignments: assignments.map((a) => ({
        assignment: a.assignment,
        instructor: instructorById.get(a.assignment.instructorId) ?? null,
        usedBytes: a.usedBytes,
        fileCount: a.fileCount,
      })),
    }));

    return NextResponse.json({ editors: response });
  } catch (error) {
    console.error("List video editors error:", error);

    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
