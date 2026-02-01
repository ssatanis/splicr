import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const { fileKeys, libraryType, sampleNames } = await request.json();

    if (!fileKeys || fileKeys.length === 0) {
      return NextResponse.json({ error: "File keys are required" }, { status: 400 });
    }

    // Mock response - in production, this would submit to a queue
    const analysisId = `analysis-${Date.now()}`;

    return NextResponse.json(
      {
        analysisId,
        status: "queued",
      },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      }
    );
  } catch (error) {
    console.error("Analysis error:", error);
    return NextResponse.json({ error: "Failed to submit analysis" }, { status: 500 });
  }
}

export async function OPTIONS() {
  return NextResponse.json(
    {},
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    }
  );
}
