// Synthetic development data. Every identity here is fictional and uses the reserved
// .test domain; demo accounts are refused when NODE_ENV=production.
import type { Language } from '../../users/user.model.js';
import type { Role } from '../../tenancy/permissions.js';

export type DemoUser = { email: string; displayName: string; language: Language };
export type DemoMembership = {
  email: string;
  role: Role;
  status?: 'active' | 'suspended';
  /** Omitted = all branches. */
  branches?: string[];
};
export type DemoOrganization = {
  key: string;
  name: string;
  branches: { name: string; city: string }[];
  members: DemoMembership[];
};

export const DEMO_USERS: DemoUser[] = [
  { email: 'owner.nour@demo.test', displayName: 'منى (مالكة تجريبية)', language: 'ar' },
  { email: 'admin.nour@demo.test', displayName: 'كريم (مدير تجريبي)', language: 'ar' },
  { email: 'doctor.nour@demo.test', displayName: 'د. هالة (تجريبية)', language: 'ar' },
  { email: 'reception.nour@demo.test', displayName: 'سلمى (استقبال تجريبي)', language: 'ar' },
  { email: 'viewer.nour@demo.test', displayName: 'Omar (demo viewer)', language: 'en' },
  { email: 'suspended.nour@demo.test', displayName: 'د. ياسر (موقوف تجريبي)', language: 'ar' },
  { email: 'owner.shifa@demo.test', displayName: 'Faisal (demo owner)', language: 'en' },
  { email: 'multi@demo.test', displayName: 'ريم (عضو في منشأتين)', language: 'ar' },
  { email: 'newcomer@demo.test', displayName: 'نادر (بدون منشأة)', language: 'ar' },
];

export const DEMO_ORGANIZATIONS: DemoOrganization[] = [
  {
    key: 'demo-nour',
    name: 'عيادات النور (تجريبي)',
    branches: [
      { name: 'فرع مدينة نصر', city: 'القاهرة' },
      { name: 'فرع المعادي', city: 'القاهرة' },
      { name: 'فرع الإسكندرية', city: 'الإسكندرية' },
    ],
    members: [
      { email: 'owner.nour@demo.test', role: 'owner' },
      { email: 'admin.nour@demo.test', role: 'admin' },
      { email: 'doctor.nour@demo.test', role: 'doctor', branches: ['فرع المعادي'] },
      { email: 'reception.nour@demo.test', role: 'receptionist', branches: ['فرع مدينة نصر'] },
      { email: 'viewer.nour@demo.test', role: 'viewer' },
      { email: 'suspended.nour@demo.test', role: 'doctor', status: 'suspended' },
      { email: 'multi@demo.test', role: 'admin' },
    ],
  },
  {
    key: 'demo-shifa',
    name: 'مركز الشفاء (تجريبي)',
    branches: [
      { name: 'فرع العليا', city: 'الرياض' },
      { name: 'فرع جدة', city: 'جدة' },
    ],
    members: [
      { email: 'owner.shifa@demo.test', role: 'owner' },
      { email: 'multi@demo.test', role: 'doctor', branches: ['فرع جدة'] },
    ],
  },
];
