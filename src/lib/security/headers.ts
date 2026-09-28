export function securityHeaders(options: { production: boolean; nonce?: string }): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "style-src 'self' https://fonts.googleapis.com",
    "style-src-attr 'unsafe-inline'",
    `script-src 'self'${options.nonce ? ` 'nonce-${options.nonce}'` : ""} https://www.gstatic.com`,
    `connect-src 'self' ${process.env.ELEMARKET_CSP_CONNECT_SRC ?? "https://api.paystack.co https://api.geoapify.com https://fcm.googleapis.com https://firebaseinstallations.googleapis.com https://securetoken.googleapis.com"}`,
  ].join("; ");
  return {
    "Content-Security-Policy": csp,
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Origin-Agent-Cluster": "?1",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), payment=(self)",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    ...(options.production ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload" } : {}),
  };
}
