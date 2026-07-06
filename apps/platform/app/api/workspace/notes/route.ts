import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

export async function POST(request: Request) {
  try {
    const clerkAuth = await auth();
    const userId = clerkAuth.userId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { workspaceId, title, content, sessionId } = body as {
      workspaceId: string;
      title: string;
      content: string;
      // PR #4b: optional — when set, the note is auto-tagged to the
      // active video-call session. The Notes composer sends this for
      // any new note created while the call is live.
      sessionId?: string;
    };

    if (!workspaceId || !title) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const token = await clerkAuth.getToken({ template: "convex" });
    if (!token) {
      return NextResponse.json({ error: "Failed to get auth token" }, { status: 401 });
    }

    const noteId = await fetchMutation(
      api.workspaces.createWorkspaceNote,
      {
        workspaceId: workspaceId as Id<"workspaces">,
        title,
        content: content || "",
        sessionId: sessionId ? (sessionId as Id<"sessions">) : undefined,
      },
      { token }
    );

    return NextResponse.json({ noteId });
  } catch (error) {
    console.error("[workspace/notes] Failed to create note:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create note" },
      { status: 500 }
    );
  }
}