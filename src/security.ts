import type { Request } from "express";

function normalizedHost(value: string): string {
  const host = value.trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(1, host.indexOf("]"));
  return host.split(":")[0];
}

export function isPrivateHost(value: string): boolean {
  const host = normalizedHost(value);
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "0.0.0.0") return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d{1,3})\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  return /^(?:fc|fd)[0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);
}

export function transportSecurity(protocol: string, host: string): {
  secure: boolean;
  publicAddress: boolean;
  warning: boolean;
  host: string;
} {
  const normalized = normalizedHost(host);
  const secure = protocol.toLowerCase() === "https";
  const publicAddress = !isPrivateHost(normalized);
  return { secure, publicAddress, warning: !secure && publicAddress, host: normalized };
}

export function requestTransportSecurity(req: Request): ReturnType<typeof transportSecurity> {
  return transportSecurity(req.secure ? "https" : req.protocol, req.get("host") || req.hostname || "");
}

export function responseSecurityHeaders(secure: boolean): Record<string, string> {
  return {
    "Content-Security-Policy": "default-src 'self'; base-uri 'self'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...(secure ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
  };
}
