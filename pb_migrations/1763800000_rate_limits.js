/// <reference path="../pb_data/types.d.ts" />

// Slows down password guessing on the public site.
// Cloudflare puts the visitor's real IP in CF-Connecting-IP (visitors can't fake it), so limits
// apply per person instead of to everyone at once. Requests from the Pi itself (tests, health
// checks) aren't limited — and if the header were ever missing, everything would look local and
// nothing would be limited, exactly like before this migration.

migrate(
  (app) => {
    const s = app.settings()
    unmarshal(
      {
        trustedProxy: { headers: ["CF-Connecting-IP"], useLeftmostIP: false },
        rateLimits: {
          enabled: true,
          excludedIPs: ["127.0.0.1", "::1"],
          rules: [
            // Signing in (staff app and the dashboard): 6 tries per 15 seconds per IP.
            { label: "*:auth", audience: "", maxRequests: 6, duration: 15 },
            // Invite links and first-time setup.
            { label: "/api/ch/invites/", audience: "@guest", maxRequests: 20, duration: 60 },
            { label: "/api/ch/setup", audience: "", maxRequests: 5, duration: 60 },
            { label: "*:create", audience: "", maxRequests: 30, duration: 5 },
            { label: "/api/batch", audience: "", maxRequests: 3, duration: 1 },
            // Everything else: plenty for a whole team on the same Wi-Fi.
            { label: "/api/", audience: "", maxRequests: 600, duration: 10 },
          ],
        },
      },
      s,
    )
    app.save(s)
  },
  (app) => {
    const s = app.settings()
    unmarshal({ trustedProxy: { headers: [] }, rateLimits: { enabled: false } }, s)
    app.save(s)
  },
)
