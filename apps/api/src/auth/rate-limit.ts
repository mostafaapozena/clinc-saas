import { rateLimit } from 'express-rate-limit';

/**
 * In-memory, per-IP limiter. Behind a reverse proxy set TRUST_PROXY so req.ip is the client.
 * Production with several API instances needs a shared store (documented gap).
 */
export function createRateLimiter({ max, windowMs }: { max: number; windowMs: number }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    // Proxy trust is configured explicitly via TRUST_PROXY, so skip the forwarded-header warning.
    validate: { xForwardedForHeader: false },
    handler: (_req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
      });
    },
  });
}
