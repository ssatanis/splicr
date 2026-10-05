import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdf-parse", "@napi-rs/canvas"],
  // The dev-mode route indicator (bottom-left badge/toast on every
  // navigation) is a debugging aid, not something visitors should see.
  devIndicators: false,
  // The Atlas snapshot is read from disk at runtime rather than imported, so
  // the tracer cannot see it. Without this a serverless build would ship the
  // Atlas routes without their data.
  outputFileTracingIncludes: {
    "/dashboard": ["./src/lib/atlas/data/**/*"],
    "/dashboard/**": ["./src/lib/atlas/data/**/*"],
  },
  experimental: {
    // A lab logo is posted to a Server Action as a file. The default body
    // limit is 1 MB, which a photographed crest from a university brand pack
    // exceeds without being in any way unreasonable. The storage bucket
    // refuses anything over 2 MB and the action checks the same number before
    // it uploads, so this is the outer of three agreeing limits rather than a
    // new allowance.
    serverActions: { bodySizeLimit: "3mb" },
  },
};

export default nextConfig;
