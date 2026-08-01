import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The control plane is small and personal; every page depends on the viewer's session,
  // so nothing here chases static generation. Keep the config minimal on purpose.
  reactStrictMode: true,
};

export default nextConfig;
