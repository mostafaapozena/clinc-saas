import type { AuthContext } from '../auth/session.middleware.js';
import type { TenantContext } from '../tenancy/tenant-context.js';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
      tenant?: TenantContext;
    }
  }
}

export {};
