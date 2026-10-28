// Synthetic development data. Every identity here is fictional and uses the reserved
// .test domain; demo accounts are refused when NODE_ENV=production. Phone numbers are
// syntactically valid but invented. No clinical information of any kind.
import type { Language } from '../../users/user.model.js';
import type { Role } from '../../tenancy/permissions.js';
import type { AppointmentStatus } from '../appointments/appointment.state.js';
import type { PhoneCountry } from '../patients/normalize.js';

export type DemoUser = { email: string; displayName: string; language: Language };
export type DemoMembership = {
  email: string;
  role: Role;
  status?: 'active' | 'suspended';
  /** Omitted = all branches. */
  branches?: string[];
};
export type DemoPractitioner = {
  email: string;
  displayName: string;
  specialtyCode: string;
  durationMinutes: number;
  /** Weekly hours per branch, applied to every weekday. */
  hours: { branch: string; start: string; end: string }[];
};
export type DemoException = {
  key: string;
  practitioner: string;
  /** Days after today (organization's local date). */
  day: number;
  kind: 'closed' | 'hours';
  /** null = every branch (closures only). */
  branch: string | null;
  intervals?: { start: string; end: string }[];
};
export type DemoPatient = {
  key: string;
  fullName: string;
  phone: { country: PhoneCountry; number: string };
  sex?: 'female' | 'male' | 'unspecified';
  dateOfBirth?: string;
  registrations: { branch: string; status?: 'active' | 'archived' }[];
};
export type DemoAppointment = {
  key: string;
  practitioner: string;
  patient: string;
  branch: string;
  /** Days relative to today (organization's local date). */
  day: number;
  time: string;
  status: AppointmentStatus;
  type?: 'new_visit' | 'follow_up';
  reason?: string;
};
/** Synthetic visit record (phase 5). Text is invented for demonstration, never real patient data. */
export type DemoEncounter = {
  key: string;
  /** Key of the appointment it documents; the author is that appointment's practitioner. */
  appointment: string;
  status: 'draft' | 'finalized';
  sections: Partial<Record<'reason' | 'history' | 'examination' | 'assessment' | 'plan', string>>;
  lateEntryReason?: string;
  addenda?: { key: string; reason: string; content: string }[];
};
export type DemoOrganization = {
  key: string;
  name: string;
  timeZone: string;
  /** null + no specialties = an organization as it was before phase 4 (setup not done yet). */
  type: 'clinic' | 'medical_center' | 'multi_branch' | null;
  specialtyCodes: string[];
  branches: { name: string; city: string; specialtyCodes: string[] }[];
  members: DemoMembership[];
  practitioners: DemoPractitioner[];
  exceptions: DemoException[];
  patients: DemoPatient[];
  appointments: DemoAppointment[];
  encounters?: DemoEncounter[];
};

export const DEMO_USERS: DemoUser[] = [
  { email: 'owner.nour@demo.test', displayName: 'منى (مالكة تجريبية)', language: 'ar' },
  { email: 'admin.nour@demo.test', displayName: 'كريم (مدير تجريبي)', language: 'ar' },
  { email: 'doctor.nour@demo.test', displayName: 'د. هالة (تجريبية)', language: 'ar' },
  { email: 'doctor2.nour@demo.test', displayName: 'د. سامي (تجريبي)', language: 'ar' },
  { email: 'reception.nour@demo.test', displayName: 'سلمى (استقبال تجريبي)', language: 'ar' },
  { email: 'viewer.nour@demo.test', displayName: 'Omar (demo viewer)', language: 'en' },
  { email: 'suspended.nour@demo.test', displayName: 'د. ياسر (موقوف تجريبي)', language: 'ar' },
  { email: 'owner.shifa@demo.test', displayName: 'Faisal (demo owner)', language: 'en' },
  { email: 'multi@demo.test', displayName: 'ريم (عضو في منشأتين)', language: 'ar' },
  { email: 'newcomer@demo.test', displayName: 'نادر (بدون منشأة)', language: 'ar' },
  { email: 'owner.legacy@demo.test', displayName: 'حسام (مالك منشأة قديمة)', language: 'ar' },
];

const NASR = 'فرع مدينة نصر';
const MAADI = 'فرع المعادي';
const ALEX = 'فرع الإسكندرية';
const JEDDAH = 'فرع جدة';

export const DEMO_ORGANIZATIONS: DemoOrganization[] = [
  {
    key: 'demo-nour',
    name: 'عيادات النور (تجريبي)',
    timeZone: 'Africa/Cairo',
    // A medical center with two specialties, offered at different branches.
    type: 'medical_center',
    specialtyCodes: ['dentistry', 'physiotherapy'],
    branches: [
      { name: NASR, city: 'القاهرة', specialtyCodes: ['physiotherapy', 'dentistry'] },
      { name: MAADI, city: 'القاهرة', specialtyCodes: ['dentistry'] },
      { name: ALEX, city: 'الإسكندرية', specialtyCodes: ['physiotherapy'] },
    ],
    members: [
      { email: 'owner.nour@demo.test', role: 'owner' },
      { email: 'admin.nour@demo.test', role: 'admin' },
      { email: 'doctor.nour@demo.test', role: 'doctor', branches: [MAADI] },
      { email: 'doctor2.nour@demo.test', role: 'doctor', branches: [NASR, ALEX] },
      { email: 'reception.nour@demo.test', role: 'receptionist', branches: [NASR] },
      { email: 'viewer.nour@demo.test', role: 'viewer' },
      { email: 'suspended.nour@demo.test', role: 'doctor', status: 'suspended' },
      { email: 'multi@demo.test', role: 'admin' },
    ],
    practitioners: [
      {
        email: 'doctor.nour@demo.test',
        displayName: 'د. هالة',
        specialtyCode: 'dentistry',
        durationMinutes: 30,
        hours: [{ branch: MAADI, start: '09:00', end: '17:00' }],
      },
      {
        // Works at two branches, never at the same time.
        email: 'doctor2.nour@demo.test',
        displayName: 'د. سامي',
        specialtyCode: 'physiotherapy',
        durationMinutes: 30,
        hours: [
          { branch: NASR, start: '10:00', end: '14:00' },
          { branch: ALEX, start: '16:00', end: '21:00' },
        ],
      },
    ],
    exceptions: [
      { key: 'hala-closed', practitioner: 'doctor.nour@demo.test', day: 3, kind: 'closed', branch: null },
      {
        key: 'sami-late-start',
        practitioner: 'doctor2.nour@demo.test',
        day: 2,
        kind: 'hours',
        branch: NASR,
        intervals: [{ start: '12:00', end: '15:00' }],
      },
    ],
    patients: [
      { key: 'p1', fullName: 'أحمد محمود علي', phone: { country: 'EG', number: '01001234501' }, sex: 'male', dateOfBirth: '1984-03-12', registrations: [{ branch: NASR }] },
      // A family sharing one phone number (valid; not a duplicate).
      { key: 'p2', fullName: 'فاطمة حسن', phone: { country: 'EG', number: '01001234502' }, sex: 'female', registrations: [{ branch: NASR }] },
      { key: 'p3', fullName: 'يوسف حسن', phone: { country: 'EG', number: '01001234502' }, sex: 'male', dateOfBirth: '2015-09-01', registrations: [{ branch: NASR }, { branch: MAADI }] },
      { key: 'p4', fullName: 'Sara Adel', phone: { country: 'EG', number: '01221234504' }, sex: 'female', registrations: [{ branch: MAADI }] },
      // Only registered in Alexandria: invisible to the Nasr City receptionist.
      { key: 'p5', fullName: 'منى إبراهيم', phone: { country: 'EG', number: '01111234505' }, sex: 'female', registrations: [{ branch: ALEX }] },
      { key: 'p6', fullName: 'Karim Nabil', phone: { country: 'EG', number: '01501234506' }, sex: 'male', registrations: [{ branch: NASR }, { branch: ALEX }] },
      { key: 'p7', fullName: 'هدى سمير', phone: { country: 'EG', number: '01001234507' }, registrations: [{ branch: MAADI }, { branch: NASR, status: 'archived' }] },
      { key: 'p8', fullName: 'عمر خالد', phone: { country: 'EG', number: '01001234508' }, sex: 'male', registrations: [{ branch: ALEX }] },
      { key: 'p9', fullName: 'ليلى مصطفى', phone: { country: 'EG', number: '01001234509' }, sex: 'female', registrations: [{ branch: NASR }] },
    ],
    appointments: [
      // Dr. Hala — Maadi
      { key: 'a01', practitioner: 'doctor.nour@demo.test', patient: 'p4', branch: MAADI, day: -2, time: '09:00', status: 'completed' },
      { key: 'a02', practitioner: 'doctor.nour@demo.test', patient: 'p3', branch: MAADI, day: -2, time: '09:30', status: 'no_show' },
      { key: 'a03', practitioner: 'doctor.nour@demo.test', patient: 'p7', branch: MAADI, day: -2, time: '10:00', status: 'cancelled', reason: 'طلب المريض' },
      { key: 'a04', practitioner: 'doctor.nour@demo.test', patient: 'p4', branch: MAADI, day: -1, time: '11:00', status: 'completed', type: 'follow_up' },
      { key: 'a05', practitioner: 'doctor.nour@demo.test', patient: 'p4', branch: MAADI, day: 0, time: '09:00', status: 'completed', type: 'follow_up' },
      { key: 'a06', practitioner: 'doctor.nour@demo.test', patient: 'p3', branch: MAADI, day: 0, time: '09:30', status: 'checked_in' },
      { key: 'a07', practitioner: 'doctor.nour@demo.test', patient: 'p7', branch: MAADI, day: 0, time: '11:00', status: 'scheduled' },
      { key: 'a08', practitioner: 'doctor.nour@demo.test', patient: 'p4', branch: MAADI, day: 0, time: '15:30', status: 'scheduled', type: 'follow_up' },
      { key: 'a09', practitioner: 'doctor.nour@demo.test', patient: 'p4', branch: MAADI, day: 1, time: '10:00', status: 'scheduled', type: 'follow_up' },
      { key: 'a10', practitioner: 'doctor.nour@demo.test', patient: 'p3', branch: MAADI, day: 5, time: '09:00', status: 'scheduled' },
      // Dr. Sami — Nasr City in the morning, Alexandria in the evening
      { key: 'b01', practitioner: 'doctor2.nour@demo.test', patient: 'p1', branch: NASR, day: -1, time: '10:00', status: 'completed' },
      { key: 'b02', practitioner: 'doctor2.nour@demo.test', patient: 'p5', branch: ALEX, day: -1, time: '16:00', status: 'completed' },
      { key: 'b03', practitioner: 'doctor2.nour@demo.test', patient: 'p1', branch: NASR, day: 0, time: '10:00', status: 'completed' },
      { key: 'b04', practitioner: 'doctor2.nour@demo.test', patient: 'p6', branch: NASR, day: 0, time: '10:30', status: 'in_progress' },
      { key: 'b05', practitioner: 'doctor2.nour@demo.test', patient: 'p2', branch: NASR, day: 0, time: '11:00', status: 'checked_in' },
      { key: 'b06', practitioner: 'doctor2.nour@demo.test', patient: 'p9', branch: NASR, day: 0, time: '11:30', status: 'checked_in' },
      { key: 'b07', practitioner: 'doctor2.nour@demo.test', patient: 'p1', branch: NASR, day: 0, time: '12:30', status: 'scheduled', type: 'follow_up' },
      { key: 'b08', practitioner: 'doctor2.nour@demo.test', patient: 'p5', branch: ALEX, day: 0, time: '17:00', status: 'scheduled', type: 'follow_up' },
      { key: 'b09', practitioner: 'doctor2.nour@demo.test', patient: 'p8', branch: ALEX, day: 0, time: '18:00', status: 'scheduled' },
      { key: 'b10', practitioner: 'doctor2.nour@demo.test', patient: 'p2', branch: NASR, day: 1, time: '10:00', status: 'scheduled', type: 'follow_up' },
      { key: 'b11', practitioner: 'doctor2.nour@demo.test', patient: 'p9', branch: NASR, day: 2, time: '12:30', status: 'scheduled', type: 'follow_up' },
      { key: 'b12', practitioner: 'doctor2.nour@demo.test', patient: 'p6', branch: ALEX, day: 4, time: '16:30', status: 'scheduled', type: 'follow_up' },
    ],
    // Synthetic visit records. b04 (in progress) and b03 (completed) are left without a record so
    // the start and late-entry flows can be tried as doctor2.nour.
    encounters: [
      {
        key: 'e01',
        appointment: 'a01',
        status: 'finalized',
        sections: {
          reason: 'ألم في ضرس علوي منذ ثلاثة أيام (بيانات تجريبية)',
          history: 'لا توجد حساسية معروفة مسجلة في هذا المثال التجريبي.',
          examination: 'نص فحص تجريبي للتوضيح فقط.',
          assessment: 'تقييم تجريبي للتوضيح فقط.',
          plan: 'متابعة بعد يوم واحد (مثال تجريبي).',
        },
        addenda: [{ key: 'e01-x1', reason: 'توضيح بعد المراجعة', content: 'إضافة تجريبية توضح أن السجل الأصلي لا يتغير.' }],
      },
      {
        key: 'e02',
        appointment: 'a04',
        status: 'finalized',
        sections: { reason: 'زيارة متابعة (بيانات تجريبية)', plan: 'متابعة حسب الحاجة (مثال تجريبي).' },
      },
      {
        key: 'e03',
        appointment: 'a05',
        status: 'draft',
        sections: { reason: 'متابعة اليوم (مسودة تجريبية)', history: 'نص مسودة تجريبي لم يُعتمد بعد.' },
      },
      {
        key: 'e04',
        appointment: 'b01',
        status: 'finalized',
        sections: { reason: 'Lower back stiffness (synthetic example)', examination: 'Synthetic examination text.', plan: 'Synthetic home-exercise plan.' },
      },
      {
        key: 'e05',
        appointment: 'b02',
        status: 'finalized',
        lateEntryReason: 'Documented after the session (synthetic example)',
        sections: { reason: 'Shoulder follow-up (synthetic example)', assessment: 'Synthetic assessment text.' },
      },
    ],
  },
  {
    key: 'demo-shifa',
    name: 'مركز الشفاء (تجريبي)',
    timeZone: 'Asia/Riyadh',
    type: 'multi_branch',
    specialtyCodes: ['ent'],
    branches: [
      { name: 'فرع العليا', city: 'الرياض', specialtyCodes: ['ent'] },
      { name: JEDDAH, city: 'جدة', specialtyCodes: ['ent'] },
    ],
    members: [
      { email: 'owner.shifa@demo.test', role: 'owner' },
      { email: 'multi@demo.test', role: 'doctor', branches: [JEDDAH] },
    ],
    practitioners: [
      {
        email: 'multi@demo.test',
        displayName: 'د. ريم',
        specialtyCode: 'ent',
        durationMinutes: 20,
        hours: [{ branch: JEDDAH, start: '16:00', end: '22:00' }],
      },
    ],
    exceptions: [],
    patients: [
      { key: 's1', fullName: 'Abdullah Saleh', phone: { country: 'SA', number: '0501234601' }, sex: 'male', registrations: [{ branch: JEDDAH }] },
      { key: 's2', fullName: 'نورة سعد', phone: { country: 'SA', number: '0551234602' }, sex: 'female', registrations: [{ branch: JEDDAH }] },
    ],
    appointments: [
      { key: 'c01', practitioner: 'multi@demo.test', patient: 's1', branch: JEDDAH, day: 0, time: '16:00', status: 'checked_in' },
      { key: 'c02', practitioner: 'multi@demo.test', patient: 's2', branch: JEDDAH, day: 0, time: '17:00', status: 'scheduled' },
      { key: 'c03', practitioner: 'multi@demo.test', patient: 's1', branch: JEDDAH, day: 1, time: '16:20', status: 'scheduled', type: 'follow_up' },
    ],
  },
  {
    // Created "before phase 4": no type and no specialties yet. Its owner sees the setup prompt;
    // everything else keeps working until the specialties are chosen in settings.
    key: 'demo-legacy',
    name: 'عيادة الأمل (تجريبي، إعداد قديم)',
    timeZone: 'Africa/Cairo',
    type: null,
    specialtyCodes: [],
    branches: [
      { name: 'الفرع الرئيسي', city: 'الجيزة', specialtyCodes: [] },
      { name: 'فرع الدقي', city: 'الجيزة', specialtyCodes: [] },
    ],
    members: [{ email: 'owner.legacy@demo.test', role: 'owner' }],
    practitioners: [],
    exceptions: [],
    patients: [
      { key: 'l1', fullName: 'Mariam Fathy', phone: { country: 'EG', number: '01001234601' }, sex: 'female', registrations: [{ branch: 'الفرع الرئيسي' }] },
    ],
    appointments: [],
  },
];
