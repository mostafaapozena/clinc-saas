import { Schema, model, type HydratedDocument, type Types } from 'mongoose';

export const LANGUAGES = ['ar', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

export interface User {
  email: string;
  passwordHash: string;
  displayName: string;
  preferredLanguage: Language;
  /** Set when the user opens an email-verification link (milestone 5). */
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<User>(
  {
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    preferredLanguage: { type: String, enum: LANGUAGES, required: true, default: 'ar' },
    emailVerifiedAt: { type: Date, default: null },
  },
  { collection: 'users', timestamps: true },
);
userSchema.index({ email: 1 }, { unique: true });

export type UserDocument = HydratedDocument<User>;
export const UserModel = model<User>('User', userSchema);

export type UserDto = {
  id: string;
  email: string;
  displayName: string;
  preferredLanguage: Language;
  emailVerified: boolean;
};

/** The only shape of a user that leaves the API — never includes the password hash. */
export function toUserDto(user: Omit<User, 'passwordHash'> & { _id: Types.ObjectId }): UserDto {
  return {
    id: String(user._id),
    email: user.email,
    displayName: user.displayName,
    preferredLanguage: user.preferredLanguage,
    emailVerified: user.emailVerifiedAt != null,
  };
}

/** Demo accounts use the reserved .test domain and are refused entirely in production. */
export function isDemoEmail(email: string): boolean {
  return email.endsWith('@demo.test');
}
