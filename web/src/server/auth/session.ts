import { verifyAccess } from './tokens';
import { Unauthorized } from '../http/errors';
import type { AuthContext } from '../rbac/rbac';

export function getAuthContext(req: Request): AuthContext {
  const header = req.headers.get('authorization') ?? '';
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) throw new Unauthorized('Missing bearer token');
  const claims = verifyAccess(m[1]!);
  return { userId: claims.sub, orgId: claims.orgId };
}
