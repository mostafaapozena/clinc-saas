import { randomBytes } from 'node:crypto';
import { hashPassword } from '../../auth/password.js';
import { OPERATOR_ROLES, OperatorModel, recordPlatformAudit, type OperatorRole } from './operator.model.js';
import { revokeOperatorSessions } from './operator-auth.js';

// Operator provisioning (used by src/scripts/operators.ts). There is no public operator registration
// and no HTTP endpoint that creates operators: whoever can run this has server and database access.
// The initial password comes from OPERATOR_PASSWORD or is generated and printed once.

export const OPERATORS_USAGE = `Usage:
  npm run operators -w @clinc/api -- create --email <email> --name <display name> --role platform_admin|support
  npm run operators -w @clinc/api -- list
  npm run operators -w @clinc/api -- suspend <email>
  npm run operators -w @clinc/api -- reactivate <email>
  npm run operators -w @clinc/api -- reset-password <email>

The password is read from OPERATOR_PASSWORD (at least 12 characters) or generated and shown once.
Suspending or resetting a password ends the operator's sessions.`;

export type OperatorCommand =
  | { kind: 'create'; email: string; name: string; role: OperatorRole }
  | { kind: 'list' }
  | { kind: 'suspend' | 'reactivate' | 'reset-password'; email: string }
  | { kind: 'help'; error?: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const option = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

export function parseOperatorArgs(argv: string[]): OperatorCommand {
  const [command, ...rest] = argv;
  if (command === 'create') {
    const email = option(rest, '--email')?.trim().toLowerCase() ?? '';
    const name = option(rest, '--name')?.trim() ?? '';
    const role = option(rest, '--role') ?? '';
    if (!EMAIL.test(email) || email.length > 254) return { kind: 'help', error: 'Invalid --email' };
    if (name.length < 2 || name.length > 80) return { kind: 'help', error: '--name must be 2–80 characters' };
    if (!(OPERATOR_ROLES as readonly string[]).includes(role)) return { kind: 'help', error: 'Unknown --role' };
    return { kind: 'create', email, name, role: role as OperatorRole };
  }
  if (command === 'list') return { kind: 'list' };
  if (command === 'suspend' || command === 'reactivate' || command === 'reset-password') {
    const email = rest[0]?.trim().toLowerCase() ?? '';
    if (!EMAIL.test(email)) return { kind: 'help', error: 'Invalid email' };
    return { kind: command, email };
  }
  return { kind: 'help', error: command ? `Unknown command "${command}"` : undefined };
}

function initialPassword(provided: string | undefined): { password: string; generated: boolean } {
  if (provided !== undefined && provided !== '') {
    if (provided.length < 12) throw new Error('OPERATOR_PASSWORD must be at least 12 characters');
    return { password: provided, generated: false };
  }
  return { password: randomBytes(18).toString('base64url'), generated: true };
}

/** Runs a command and returns the lines to print. Never prints a password it did not generate. */
export async function runOperatorsCommand(command: OperatorCommand, env: { OPERATOR_PASSWORD?: string } = {}): Promise<string[]> {
  if (command.kind === 'help') return [...(command.error ? [`Error: ${command.error}`, ''] : []), OPERATORS_USAGE];
  if (command.kind === 'list') {
    const operators = await OperatorModel.find().sort({ createdAt: 1 }).lean();
    if (operators.length === 0) return ['No operators.'];
    return operators.map((o) =>
      [o.email, o.role, o.status, o.lastLoginAt ? `last sign-in ${o.lastLoginAt.toISOString().slice(0, 16)}` : 'never signed in'].join(
        ' | ',
      ),
    );
  }
  if (command.kind === 'create') {
    if (await OperatorModel.exists({ email: command.email })) return [`Error: an operator with ${command.email} already exists.`];
    const { password, generated } = initialPassword(env.OPERATOR_PASSWORD);
    const operator = await OperatorModel.create({
      email: command.email,
      displayName: command.name,
      role: command.role,
      passwordHash: await hashPassword(password),
    });
    await recordPlatformAudit({
      operatorId: null,
      actor: 'system',
      action: 'operator.provisioned',
      target: { type: 'operator', id: String(operator._id) },
      changes: { role: command.role, via: 'cli' },
    });
    return [
      `Created ${command.role} operator ${command.email}.`,
      generated ? `Initial password (shown only now): ${password}` : 'Password: the OPERATOR_PASSWORD value.',
    ];
  }
  const operator = await OperatorModel.findOne({ email: command.email });
  if (!operator) return [`Error: no operator with ${command.email}.`];
  if (command.kind === 'reset-password') {
    const { password, generated } = initialPassword(env.OPERATOR_PASSWORD);
    operator.passwordHash = await hashPassword(password);
    await operator.save();
    await revokeOperatorSessions(operator._id);
    await recordPlatformAudit({
      operatorId: null,
      actor: 'system',
      action: 'operator.password_reset',
      target: { type: 'operator', id: String(operator._id) },
      changes: { via: 'cli' },
    });
    return [
      `Password reset for ${command.email}; sessions ended.`,
      generated ? `New password (shown only now): ${password}` : 'Password: the OPERATOR_PASSWORD value.',
    ];
  }
  const status = command.kind === 'suspend' ? 'suspended' : 'active';
  if (
    status === 'suspended' &&
    operator.role === 'platform_admin' &&
    (await OperatorModel.countDocuments({ role: 'platform_admin', status: 'active' })) <= 1
  ) {
    return ['Error: at least one active platform administrator must remain.'];
  }
  const from = operator.status;
  operator.status = status;
  await operator.save();
  if (status === 'suspended') await revokeOperatorSessions(operator._id);
  await recordPlatformAudit({
    operatorId: null,
    actor: 'system',
    action: 'operator.status_changed',
    target: { type: 'operator', id: String(operator._id) },
    changes: { from, to: status, via: 'cli' },
  });
  return [`${command.email}: ${from} → ${status}.`];
}
