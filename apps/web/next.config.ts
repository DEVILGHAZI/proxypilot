import type { NextConfig } from "next";
import path from "node:path";
import { loadEnvFile } from "node:process";

const rootEnv = path.join(import.meta.dirname, "../../.env");
try {
  loadEnvFile(rootEnv);
} catch {
  // Containers inject environment variables directly.
}

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiBaseUrl}/api/v1/:path*`,
      },
    ];
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
