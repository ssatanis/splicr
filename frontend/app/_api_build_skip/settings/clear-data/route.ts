import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * POST /api/settings/clear-data
 * Clears all of the authenticated user's data in the database:
 * - Shares where the user is the recipient (analysis_shares.user_id)
 * - Activity logs (activity_logs)
 * - All analyses owned by the user (cascades to comments, activity, shares for those analyses)
 * Requires authentication.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { message: "You must be signed in to clear data." },
        { status: 401 }
      );
    }

    const admin = await createAdminClient();
    const userId = user.id;

    // 1. Delete shares where this user is the recipient (shared with me)
    await (admin.from("analysis_shares") as any)
      .delete()
      .eq("user_id", userId);

    // 2. Delete user's activity logs
    await (admin.from("activity_logs") as any)
      .delete()
      .eq("user_id", userId);

    // 3. Delete all analyses owned by the user (CASCADE removes related comments, activity, shares for those analyses)
    const { error: analysesError } = await (admin.from("analyses") as any)
      .delete()
      .eq("user_id", userId);

    if (analysesError) {
      console.error("Clear data: analyses delete error", analysesError);
      return NextResponse.json(
        { message: "Failed to clear some data. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Clear data error:", error);
    return NextResponse.json(
      { message: "Failed to clear data. Please try again." },
      { status: 500 }
    );
  }
}
