import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { rateLimit } from "@/lib/utils";
import { z } from "zod";

const digestSettingsResponseSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  admin_email: z.string().email(),
  last_sent_at: z.string().nullable(),
  updated_at: z.string(),
});

const digestSettingsUpdateSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly", "monthly"]),
  adminEmail: z.string().email(),
});

export async function GET(): Promise<NextResponse> {
  try {
    await requireAdmin();

    const { data, error } = await supabase
      .from("admin_digest_settings")
      .select("*")
      .eq("id", "default")
      .single();

    if (error) {
      console.error("Error fetching digest settings:", error);
      return NextResponse.json(
        { error: "Failed to fetch digest settings" },
        { status: 500 }
      );
    }

    const validatedData = digestSettingsResponseSchema.safeParse(data);
    if (!validatedData.success) {
      console.error("Invalid digest settings data:", validatedData.error.format());
      return NextResponse.json(
        { error: "Invalid digest settings data" },
        { status: 500 }
      );
    }

    return NextResponse.json(validatedData.data);
  } catch (error) {
    console.error("Error in GET /api/admin/digest-settings:", error);
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const adminId = await requireAdmin();

    const rateLimitResult = await rateLimit(`admin:${adminId}`, 10, 60000);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Too many requests", resetAt: rateLimitResult.resetAt },
        { status: 429 }
      );
    }

    const body = await request.json();
    const validatedData = digestSettingsUpdateSchema.parse(body);

    const { data, error } = await supabase
      .from("admin_digest_settings")
      .update({
        enabled: validatedData.enabled,
        frequency: validatedData.frequency,
        admin_email: validatedData.adminEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "default")
      .select()
      .single();

    if (error) {
      console.error("Error updating digest settings:", error);
      return NextResponse.json(
        { error: "Failed to update digest settings" },
        { status: 500 }
      );
    }

    const validatedResponse = digestSettingsResponseSchema.safeParse(data);
    if (!validatedResponse.success) {
      console.error("Invalid digest settings response:", validatedResponse.error.format());
      return NextResponse.json(
        { error: "Invalid response from database" },
        { status: 500 }
      );
    }

    return NextResponse.json(validatedResponse.data);
  } catch (error) {
    console.error("Error in PUT /api/admin/digest-settings:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid input data", details: error.issues },
        { status: 400 }
      );
    }
    if (error instanceof Error && error.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
