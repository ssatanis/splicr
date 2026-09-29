import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
};

export default nextConfig;
