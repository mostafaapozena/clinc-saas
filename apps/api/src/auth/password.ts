import { hash, verify } from '@node-rs/argon2';

// Argon2id with the OWASP baseline parameters (19 MiB memory, 2 iterations, 1 lane).
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password. When there is no account, a dummy hash is still verified so
 * response timing does not reveal whether the email exists.
 */
export async function verifyPassword(
  passwordHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!passwordHash) {
    dummyHash ??= hash('timing-equalizer-not-a-real-password', ARGON2_OPTIONS);
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}
