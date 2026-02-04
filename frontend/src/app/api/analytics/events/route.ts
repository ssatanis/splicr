import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface IncomingEvent {
  event_type: string;
  event_category: string;
  resource_id?: string;
  resource_type?: string;
  metadata?: Record<string, unknown>;
  lab_id?: string;
  session_id?: string;
}

export async function POST(request: Request) {
  try {
    const { user, error: authError } = await getApiUser();
    if (authError || !user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }

    const body = await request.json();
    const events = Array.isArray(body?.events) ? body.events : [];
    if (events.length === 0) {
      return NextResponse.json({ ok: true });
    }
    if (events.length > 100) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const rows = events.slice(0, 100).map((e: IncomingEvent) => ({
      user_id: user.id,
      lab_id: e.lab_id ?? null,
      event_type: String(e.event_type).slice(0, 100),
      event_category: String(e.event_category).slice(0, 50),
      resource_id: e.resource_id ?? null,
      resource_type: e.resource_type ? String(e.resource_type).slice(0, 50) : null,
      metadata: e.metadata && typeof e.metadata === "object" ? e.metadata : {},
      session_id: e.session_id ? String(e.session_id).slice(0, 100) : null,
    }));

    const { error } = await supabaseAdmin.from("analytics_events").insert(rows);
    if (error) {
      console.error("Analytics events insert error:", error.message);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Analytics events API error:", err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
