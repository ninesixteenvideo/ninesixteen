/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@ninesixteen/brand"],
  experimental: {
    optimizePackageImports: ["firebase"],
  },
  async headers() {
    const authDomain =
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
      "ninesixteenvideo-732af.firebaseapp.com";

    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://apis.google.com https://www.gstatic.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https: https://lh3.googleusercontent.com",
      "font-src 'self' data:",
      [
        "connect-src 'self'",
        "https://*.googleapis.com",
        "https://*.google.com",
        "https://*.firebaseio.com",
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
        "https://firebase.googleapis.com",
        "https://www.googleapis.com",
        "https://api.stripe.com",
        "wss://*.firebaseio.com",
      ].join(" "),
      [
        "frame-src 'self'",
        `https://${authDomain}`,
        "https://accounts.google.com",
        "https://www.google.com",
        "https://js.stripe.com",
        "https://hooks.stripe.com",
      ].join(" "),
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
