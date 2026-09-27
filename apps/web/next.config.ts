import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-mode route indicator (bottom-left badge/toast on every
  // navigation) is a debugging aid, not something visitors should see.
  devIndicators: false,
};

export default nextConfig;
