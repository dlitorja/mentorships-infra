import { currentUser } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAdmin } from "@/lib/auth";
import { z } from "zod";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const WaitlistDeleteSchema = z.object({
  ids: z.preprocess((val) => {
    const arr = z.array(z.union([z.string(), z.number()])).parse(val);
    return arr.map((id) => String(id));
  }, z.array(z.string()).nonempty()),
});

const WaitlistItemSchema = z.object({
  id: z.string(),
  email: z.string(),
  instructor_slug: z.string(),
  mentorship_type: z.string(),
});

const DeleteResponseSchema = z.object({
  data: z.array(WaitlistItemSchema),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Server configuration error: Supabase not configured" },
      { status: 500 }
    );
  }

  let user = null;
  try {
    user = await currentUser();
  } catch (e) {
    console.error("Auth error:", e);
    return NextResponse.json({ error: "Authentication error" }, { status: 401 });
  }

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = WaitlistDeleteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.message || "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ids } = parsed.data;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const deleteResult = await supabase
      .from("marketing_waitlist")
      .delete()
      .in("id", ids)
      .select()
      .throwOnError();

    const deleteValidated = DeleteResponseSchema.safeParse(deleteResult);
    if (!deleteValidated.success) {
      console.error("Invalid delete response:", deleteValidated.error);
      return NextResponse.json({ success: false, deletedCount: 0 }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      deletedCount: deleteValidated.data.data.length,
    });
  } catch (error) {
    console.error("Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
