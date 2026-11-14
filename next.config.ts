import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification tokens and Auth codes are query parameters. Suppress these
  // development request logs; production ingress must redact them separately.
  logging: { serverFunctions: false, browserToTerminal: false, incomingRequests: { ignore: [/\/api\/webhooks\/(?:whatsapp|meta)(?:\?|\/|$)/, /\/auth\/(?:callback|confirm|recovery)(?:\?|\/|$)/] } },
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
