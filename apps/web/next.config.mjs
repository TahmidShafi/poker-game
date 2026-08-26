/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@poker/shared-types"],
  // Hide the Next.js dev-tools badge (the "N" bubble in the corner) — it is
  // scaffolding, not part of the game UI.
  devIndicators: false,
};

export default nextConfig;
