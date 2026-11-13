import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Meta's verification token is a query parameter. Suppress development request
  // logs for this endpoint; production ingress must redact it separately.
  logging: { incomingRequests: { ignore: [/\/api\/webhooks\/whatsapp(?:\?|\/|$)/] } },
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
