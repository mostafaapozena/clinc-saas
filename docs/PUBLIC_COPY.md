# raclinic public wording — review copy

_Generated from `apps/web/src/i18n/locales/{ar,en}.json`; do not edit by hand (see
`apps/web/src/public/copy-doc.ts`). Status: **provisional, pending owner review in the phase 4 PR.**_

Each table lists every string of one page or block. "Key" is the translation key, for reference
when asking for a change.

## Brand and navigation (every public page)

| Key | العربية | English |
| --- | --- | --- |
| `app.name` | raclinic | raclinic |
| `app.tagline` | مساعدك الذكي في كل تفاصيل العيادة | Smart clinic management |
| `site.nav.main` | القائمة الرئيسية | Main |
| `site.nav.home` | الرئيسية | Home |
| `site.nav.solutions` | الحلول | Solutions |
| `site.nav.custom` | المشروعات المخصصة | Custom projects |
| `site.nav.signIn` | تسجيل الدخول | Sign in |
| `site.nav.createWorkspace` | أنشئ مساحة عمل | Create a workspace |
| `site.nav.goToWorkspace` | الانتقال إلى مساحة العمل | Go to my workspace |
| `site.nav.openMenu` | فتح القائمة | Open menu |
| `site.nav.closeMenu` | إغلاق القائمة | Close menu |
| `site.nav.tour` | جولة المنتج | Product tour |
| `site.nav.company` | الشركة | Company |
| `site.nav.about` | عن raclinic | About raclinic |
| `site.nav.contact` | تواصل معنا | Contact us |
| `site.nav.faq` | الأسئلة الشائعة | FAQ |
| `site.nav.security` | الأمان وحماية البيانات | Security and data protection |
| `site.nav.privacy` | الخصوصية | Privacy |
| `site.nav.solutionsMenu` | تخصصات مساحة العمل المستضافة | Hosted workspace specialties |
| `site.nav.customMenu` | الأشعة والمشروعات المخصصة | Radiology and custom projects |
| `site.nav.allSolutions` | كل الحلول | All solutions |
| `site.nav.breadcrumb` | مسار التنقل | Breadcrumb |
| `site.nav.homeLink` | raclinic — الصفحة الرئيسية | raclinic — home |
| `site.nav.mobile` | قائمة التنقل | Site menu |
| `site.nav.descriptions.about` | لماذا بنينا raclinic، ومن يطوّره | Why raclinic exists and who builds it |
| `site.nav.descriptions.contact` | سؤال أو طلب عرض توضيحي | A question or a demo request |
| `site.nav.descriptions.security` | كيف تُحمى البيانات في مساحة العمل | How data is protected in the workspace |
| `site.nav.descriptions.privacy` | ما الذي يجمعه هذا الموقع ولماذا | What this website collects and why |
| `site.nav.descriptions.custom` | مراكز الأشعة والأنظمة التي تُدار بشكل منفصل | Radiology centers and separately run systems |
| `site.cta.create` | أنشئ مساحة عمل لعيادتك | Create your clinic workspace |
| `site.cta.custom` | اطلب مشروعًا مخصصًا | Request a custom project |
| `site.notice` | raclinic قيد التطوير: استخدم بيانات تجريبية فقط. لم تُعلن الأسعار وشروط الاشتراك بعد. | raclinic is in development: use test data only. Prices and subscription terms have not been announced yet. |
| `site.sticky.label` | إجراءات سريعة | Quick actions |
| `site.sticky.text` | raclinic — مساحة عمل لعيادتك بالعربية والإنجليزية | raclinic — a workspace for your clinic, in Arabic and English |
| `site.sticky.dismiss` | إخفاء الشريط | Hide this bar |
| `site.footer.about` | raclinic — مساحة عمل سحابية للعيادات والمراكز الطبية في مصر والسعودية. | raclinic — a cloud workspace for clinics and medical centers in Egypt and Saudi Arabia. |
| `site.footer.devNotice` | نسخة تطوير: استخدم بيانات تجريبية فقط ولا تُدخل بيانات مرضى حقيقية. | Development version: use test data only and do not enter real patient information. |
| `site.footer.status` | حالة النظام | System status |
| `site.footer.byDevware` | raclinic منتج تطوّره شركة Devware. | raclinic is a product built by Devware. |
| `site.footer.groups.solutions` | الحلول | Solutions |
| `site.footer.groups.product` | المنتج | Product |
| `site.footer.groups.company` | الشركة | Company |
| `site.footer.groups.account` | الحساب | Account |
| `site.footer.customRequest` | اطلب مشروعًا مخصصًا | Request a custom project |
| `site.footer.rights` | © {{year}} Devware. جميع الحقوق محفوظة. | © {{year}} Devware. All rights reserved. |

## Home page (`/`)

| Key | العربية | English |
| --- | --- | --- |
| `site.home.metaTitle` | إدارة المواعيد والاستقبال وملفات المرضى | Appointments, front desk and patient records for clinics |
| `site.home.metaDescription` | raclinic مساحة عمل سحابية بالعربية والإنجليزية للعيادات والمراكز الطبية في مصر والسعودية: سجل المرضى، وجداول الأطباء، والحجز دون تعارض، وتسجيل الوصول، وقائمة الانتظار. | raclinic is a bilingual cloud workspace for clinics and medical centers in Egypt and Saudi Arabia: patient registry, doctors' schedules, conflict-free booking, check-in and the daily queue. |
| `site.home.eyebrow` | مساعدك الذكي في كل تفاصيل العيادة | Smart clinic management |
| `site.home.lead` | raclinic مساحة عمل سحابية للعيادات والمراكز الطبية في مصر والسعودية. سجّل المرضى، وحدّد مواعيد عمل كل طبيب، واحجز دون تعارض، وتابع وصول المرضى وقائمة الانتظار — بالعربية أو الإنجليزية، لعيادة واحدة أو لعدة فروع. | raclinic is a cloud workspace for clinics and medical centers in Egypt and Saudi Arabia. Register patients, set each doctor's working hours, book without clashes, and follow arrivals and the waiting queue — in Arabic or English, for one clinic or several branches. |
| `site.home.signInHint` | لديك مساحة عمل بالفعل؟ | Already have a workspace? |
| `site.home.problemsTitle` | ما يتغيّر في يومك | What changes in your day |
| `site.home.problems.booking.title` | لا حجز مزدوج | No double bookings |
| `site.home.problems.booking.body` | تُحسب الأوقات المتاحة من مواعيد عمل الطبيب والحجوزات القائمة، ويتحقق النظام منها مرة أخرى لحظة تأكيد الحجز. | Free times come from the doctor's working hours and existing bookings, and are checked again the moment a booking is confirmed. |
| `site.home.problems.queue.title` | غرفة انتظار منظَّمة | An orderly waiting room |
| `site.home.problems.queue.body` | يسجّل الاستقبال وصول المريض عند حضوره، ويرى الطبيب المنتظرين حسب ترتيب وصولهم، ثم يبدأ الزيارة ويُنهيها. | Reception checks patients in as they arrive; doctors see who is waiting in order of arrival, then start and finish each visit. |
| `site.home.problems.records.title` | ملف واحد لكل مريض | One record per patient |
| `site.home.problems.records.body` | تُسجَّل بيانات التواصل مرة واحدة وتشترك فيها الفروع التي سُجّل فيها المريض، بدل الدفاتر والجداول المتفرقة. | Contact details are entered once and shared by the branches where the patient is registered, instead of scattered notebooks and spreadsheets. |
| `site.home.problems.branches.title` | عدة فروع وصلاحيات واضحة | Several branches, clear access |
| `site.home.problems.branches.body` | يرى كل عضو في الفريق الفروع والإجراءات التي يسمح بها دوره فقط، ويرى الطبيب مواعيده هو. | Each team member sees only the branches and actions their role allows; doctors see their own appointments. |
| `site.home.pathsTitle` | منصة واحدة، | One platform, |
| `site.home.pathsLead` | ابدأ من الحل الأقرب لعيادتك؛ جميع الحلول تعمل اليوم على مساحة العمل التشغيلية نفسها. | Start from the solution closest to your clinic; all of them run on the same operational workspace today. |
| `site.home.availableTitle` | المتاح اليوم | Available today |
| `site.home.availableLead` | هذه الخصائص تعمل الآن في مساحة العمل المشتركة: | These features work now in the shared workspace: |
| `site.home.plannedTitle` | غير متاح بعد | Not available yet |
| `site.home.plannedBody` | الوصفات الطبية والمرفقات، والفوترة الضريبية والإلكترونية، ومطالبات التأمين، والتذكيرات، والحجز أو الدفع الإلكتروني للمرضى — كلها مخططة لمراحل قادمة، وليست جزءًا من مساحة العمل اليوم. | Prescriptions, attachments, tax and electronic invoicing, insurance claims, reminders, and online booking or payment for patients are planned for later stages. They are not part of the workspace today. |
| `site.home.stepsTitle` | كيف تبدأ | How to get started |
| `site.home.steps.account.title` | أنشئ حسابك | Create your account |
| `site.home.steps.account.body` | اسمك وبريدك الإلكتروني وكلمة مرور. | Your name, email address and a password. |
| `site.home.steps.organization.title` | عرّف منشأتك | Describe your organization |
| `site.home.steps.organization.body` | عيادة أو مركز طبي أو منشأة متعددة الفروع، واسمها ومنطقتها الزمنية. | A clinic, a medical center or several branches — its name and time zone. |
| `site.home.steps.specialties.title` | اختر التخصصات والفرع الأول | Choose specialties and the first branch |
| `site.home.steps.specialties.body` | التخصصات التي تقدمها، وما يقدمه الفرع الأول منها. | The specialties you offer, and which of them the first branch provides. |
| `site.home.steps.workspace.title` | راجِع وابدأ | Review and start |
| `site.home.steps.workspace.body` | تأكّد من البيانات، وأنشئ مساحة العمل، ثم أضف فريقك والأطباء وباقي الفروع. | Check the details, create the workspace, then add your team, doctors and further branches. |
| `site.home.faqTitle` | إجابات سريعة | Quick answers |
| `site.home.faq.price.q` | كم التكلفة؟ | How much does it cost? |
| `site.home.faq.price.a` | لم تُعلن الأسعار وخطط الاشتراك بعد، وستُنشر قبل إتاحة raclinic تجاريًا. | Prices and subscription plans have not been announced yet. They will be published before raclinic is offered commercially. |
| `site.home.faq.clinical.q` | هل يمكنني حفظ الملاحظات والسجلات الطبية؟ | Can I keep clinical notes and medical records? |
| `site.home.faq.clinical.a` | نعم. لكل زيارة يكتب الطبيب المعالج سجلًا يشمل سبب الزيارة والتاريخ المرضي ذا الصلة ونتائج الفحص والتقييم والخطة، إضافة إلى حقول التخصص، ويحفظه كمسودة ثم يعتمده، ويضيف ملاحق مؤرخة بعد ذلك؛ ولا يتغير النص بعد اعتماده. لا يقرأ السجل إلا ذلك الطبيب (ومن يشاركه معه صراحةً من زملائه)، ويرى المالك والمدير هل وُثّقت الزيارة فقط دون محتواها. الوصفات والمرفقات غير متاحة بعد، والنماذج بانتظار مراجعة أطباء ممارسين. | Yes. For each visit, the treating doctor writes a record — reason for visit, relevant history, examination findings, assessment and plan, plus the specialty fields — saves it as a draft, finalizes it, and later adds dated addenda; the finalized text never changes. Only that doctor (and colleagues they explicitly share it with) can read it; owners and administrators see whether a visit is documented, not what it says. Prescriptions and attachments are not available yet, and the templates are pending review by practising clinicians. |
| `site.home.faq.specialties.q` | هل توجد أدوات خاصة بطب الأسنان أو العلاج الطبيعي أو الأنف والأذن والحنجرة؟ | Are there tools specific to dentistry, physiotherapy or ENT? |
| `site.home.faq.specialties.a` | نعم، كنسخة أولى: مخطط أسنان مع بنود خطة العلاج، وتقييم وجلسات وملخص إنهاء للعلاج الطبيعي، وفحص الأنف والأذن والحنجرة حسب المنطقة. كل ما فيها يكتبه الطبيب — لا توجد اقتراحات ولا محتوى مولَّد — وهي بانتظار مراجعة أطباء ممارسين. | Yes, as a first version: a dental chart with treatment-plan items, physiotherapy assessments, sessions and discharge summaries, and ENT examination by region. Everything is written by the clinician — nothing is suggested or generated — and the tools are pending review by practising clinicians. |
| `site.home.faq.ai.q` | هل يتضمن raclinic ذكاءً اصطناعيًا أو تشخيصًا؟ | Does raclinic include AI or diagnosis? |
| `site.home.faq.ai.a` | لا. شعار «مساعدك الذكي في كل تفاصيل العيادة» يعبّر عن تنظيم عمل العيادة اليومي، ولا يقدّم raclinic تشخيصًا ولا توصيات علاجية ولا يكتب ملاحظات طبية تلقائيًا. | No. Our line “Smart clinic management” is about organizing the clinic's daily work. raclinic does not diagnose, recommend treatments or write medical notes automatically. |
| `site.home.faq.branches.q` | هل يناسب مركزًا متعدد التخصصات أو الفروع؟ | Does it suit a center with several specialties or branches? |
| `site.home.faq.branches.a` | نعم. يمكنك تفعيل عدة تخصصات، واختيار الفروع التي تقدم كل تخصص، ومنح كل عضو في الفريق صلاحية الوصول إلى فروعه فقط. | Yes. You can enable several specialties, choose which branches offer each one, and give every team member access to their own branches only. |
| `site.home.faq.ownership.q` | هل يمكنني الحصول على نظام خاص بمنشأتي بدل الاشتراك؟ | Can I have a system of my own instead of a subscription? |
| `site.home.faq.ownership.a` | يمكنك طلب مشروع مخصص. يُتفق على نطاقه وجدوله الزمني والدعم والسعر لكل مشروع على حدة بعد مراجعة احتياجاتك. | You can request a custom project. Its scope, schedule, support and price are agreed separately for each project after a review of your needs. |
| `site.home.faq.data.q` | هل يمكنني إدخال بيانات مرضى حقيقية الآن؟ | Can I enter real patient data now? |
| `site.home.faq.data.a` | لا. هذه نسخة تطوير؛ يُرجى استخدام بيانات تجريبية فقط. | No. This is a development version: please use test data only. |
| `site.home.faq.languages.q` | ما اللغات المتاحة؟ | Which languages are supported? |
| `site.home.faq.languages.a` | العربية والإنجليزية، باتجاه من اليمين إلى اليسار ومن اليسار إلى اليمين، ويختار كل مستخدم لغته. | Arabic and English, with right-to-left and left-to-right layouts. Each user chooses their language. |
| `site.home.titleStart` | عيادتك منظَّمة | Your clinic, organized |
| `site.home.titleEmphasis` | من أول حجز حتى آخر زيارة | from the first booking to the last visit |
| `site.home.tourCta` | جولة في المنتج | Take the product tour |
| `site.home.reassure` | • عربي وإنجليزي بالكامل<br>• عيادة واحدة أو عدة فروع<br>• صلاحيات حسب الدور والفرع | • Fully Arabic and English<br>• One clinic or many branches<br>• Permissions by role and branch |
| `site.home.floats` | • حجز دون تعارض<br>• تسجيل الوصول وقائمة الانتظار | • No double bookings<br>• Check-in and waiting queue |
| `site.home.previewAlt` | لقطة حقيقية من صفحة المواعيد في raclinic، ببيانات تجريبية | A real screenshot of the raclinic appointments page, with demo data |
| `site.home.previewLabel` | المواعيد — raclinic | Appointments — raclinic |
| `site.home.factsLabel` | حقائق عن المنتج | Product facts |
| `site.home.facts.0.value` | 3 | 3 |
| `site.home.facts.0.label` | تخصصات بأدوات خاصة: الأسنان والعلاج الطبيعي والأنف والأذن والحنجرة | Specialties with their own tools: dentistry, physiotherapy, ENT |
| `site.home.facts.1.value` | 6 | 6 |
| `site.home.facts.1.label` | أدوار بصلاحيات محددة: مالك، مدير، طبيب، استقبال، محاسب، مطّلع | Roles with defined permissions: owner, admin, doctor, receptionist, accountant, viewer |
| `site.home.facts.2.value` | 2 | 2 |
| `site.home.facts.2.label` | لغتان كاملتان: العربية من اليمين إلى اليسار، والإنجليزية | Complete languages: Arabic right to left, and English |
| `site.home.facts.3.value` | 1 | 1 |
| `site.home.facts.3.label` | ملف واحد لكل مريض عبر كل فروع المنشأة | Patient file shared by all of an organization’s branches |
| `site.home.pathsEyebrow` | الحلول | Solutions |
| `site.home.pathsEmphasis` | لكل تخصص | every specialty |
| `site.home.problemsEyebrow` | ما نحلّه | What we solve |
| `site.home.problemsLead` | مشكلات يومية في العيادات والمراكز، وما يفعله raclinic لكل منها اليوم. | Everyday problems in clinics and centers, and what raclinic does about each of them today. |
| `site.home.featuresLabel` | أهم ما في مساحة العمل | Workspace highlights |
| `site.home.features.scheduling.eyebrow` | المواعيد والاستقبال | Appointments and front desk |
| `site.home.features.scheduling.titleStart` | جدول عيادتك، | Your clinic schedule, |
| `site.home.features.scheduling.titleEmphasis` | منظَّم لكل طبيب | organized per doctor |
| `site.home.features.scheduling.body` | مواعيد عمل أسبوعية لكل طبيب مع تعديلات لأيام محددة، وأوقات متاحة تُحسب تلقائيًا، وحجز يُتحقق منه مرة أخرى لحظة التأكيد فلا يُحجز الوقت نفسه مرتين. | Weekly working hours for every doctor with changes for specific days, free times calculated for you, and bookings checked again at the moment of confirmation, so the same time is never booked twice. |
| `site.home.features.scheduling.link` | شاهد لقطات المواعيد | See the scheduling screens |
| `site.home.features.scheduling.alt` | لقطة حقيقية من جدول المواعيد اليومي في raclinic، ببيانات تجريبية | A real screenshot of the raclinic daily schedule, with demo data |
| `site.home.features.scheduling.points` | • عرض يومي وعرض 7 أيام، لكل الأطباء أو لطبيب واحد<br>• حجز وتغيير وإلغاء، مع سبب الإلغاء<br>• تسجيل الوصول، وقائمة انتظار حسب ترتيب الوصول<br>• الأوقات بتوقيت منشأتك، مع مراعاة تغيير التوقيت الصيفي | • Day and 7-day views, for all doctors or one<br>• Book, reschedule and cancel, with a cancellation reason<br>• Check-in, and a queue in order of arrival<br>• Times in your organization’s time zone, daylight-saving aware |
| `site.home.features.records.eyebrow` | سجل الزيارة | Visit record |
| `site.home.features.records.titleStart` | سجل يكتبه الطبيب، | A record the doctor writes, |
| `site.home.features.records.titleEmphasis` | ويبقى كما اعتُمد | that stays as finalized |
| `site.home.features.records.body` | لكل زيارة سجل يكتبه الطبيب المعالج: سبب الزيارة، والتاريخ ذو الصلة، والفحص، والتقييم، والخطة. يُحفظ كمسودة ثم يُعتمد، وأي تصحيح بعد ذلك يُضاف كملحق مؤرخ. | Every visit has a record written by the treating doctor: reason, relevant history, examination, assessment and plan. It is saved as a draft, then finalized; any correction afterwards is a dated addendum. |
| `site.home.features.records.link` | أدوات طب الأسنان | See the dental tools |
| `site.home.features.records.alt` | لقطة حقيقية من سجل زيارة في raclinic، ببيانات تجريبية | A real screenshot of a raclinic visit record, with demo data |
| `site.home.features.records.points` | • لا يقرأ السجل إلا الطبيب المعالج ومن يشاركه معه صراحة<br>• يرى المالك والمدير حالة التوثيق فقط، دون المحتوى<br>• أدوات التخصص كنسخة أولى: مخطط الأسنان، ومسار العلاج الطبيعي، وفحص الأنف والأذن والحنجرة<br>• لا اقتراحات علاجية ولا نصوص مولَّدة تلقائيًا | • Only the treating doctor, and colleagues they explicitly share with, can read it<br>• Owners and admins see whether a visit is documented, never the content<br>• Specialty tools as a first version: dental chart, physiotherapy course, ENT examination<br>• No treatment suggestions and no generated text |
| `site.home.features.finance.eyebrow` | الحسابات | Finance |
| `site.home.features.finance.titleStart` | من الخدمة إلى الإيصال، | From service to receipt, |
| `site.home.features.finance.titleEmphasis` | في مكان واحد | in one place |
| `site.home.features.finance.body` | قائمة خدمات بأسعار لكل فرع، ورسوم على حساب المريض، وفواتير وإيصالات، ودفعات جزئية أو كاملة، ورصيد واضح لكل مريض. | A service list with prices per branch, charges on the patient account, invoices and receipts, partial or full payments, and a clear balance for every patient. |
| `site.home.features.finance.link` | شاهد لقطات الحسابات | See the finance screens |
| `site.home.features.finance.alt` | لقطة حقيقية من صفحة الحسابات في raclinic، ببيانات تجريبية | A real screenshot of the raclinic finance page, with demo data |
| `site.home.features.finance.points` | • أسعار مختلفة لكل فرع عند الحاجة<br>• دفعات جزئية، وإيصالات قابلة للطباعة<br>• كشف حساب لكل مريض<br>• فواتير عادية؛ الفوترة الضريبية والإلكترونية غير مدعومة بعد | • Different prices per branch when needed<br>• Partial payments and printable receipts<br>• A statement for every patient<br>• Ordinary invoices; tax and e-invoicing are not supported yet |
| `site.home.workflow.eyebrow` | يوم في العيادة | A day at the clinic |
| `site.home.workflow.title` | من الحجز | From booking |
| `site.home.workflow.emphasis` | حتى الإيصال | to receipt |
| `site.home.workflow.lead` | أربع خطوات يعمل عليها فريقك كل يوم، في مساحة العمل نفسها. | Four steps your team works through every day, in the same workspace. |
| `site.home.workflow.steps.0.title` | الحجز | Booking |
| `site.home.workflow.steps.0.body` | يختار الاستقبال الطبيب والفرع والوقت من الأوقات المتاحة فعلًا، أو يغيّر موعدًا قائمًا. | Reception picks the doctor, branch and a time that is actually free, or moves an existing appointment. |
| `site.home.workflow.steps.1.title` | الوصول | Arrival |
| `site.home.workflow.steps.1.body` | يُسجَّل وصول المريض عند حضوره، فيظهر في قائمة الانتظار حسب ترتيب الوصول. | The patient is checked in on arrival and appears in the queue in order of arrival. |
| `site.home.workflow.steps.2.title` | الزيارة | Visit |
| `site.home.workflow.steps.2.body` | يبدأ الطبيب الزيارة ويكتب سجلها، ويستخدم أدوات تخصصه، ثم يُنهي الزيارة. | The doctor starts the visit, writes its record with the specialty tools, then completes it. |
| `site.home.workflow.steps.3.title` | الحساب | Billing |
| `site.home.workflow.steps.3.body` | تُضاف الخدمات إلى حساب المريض، وتُصدر الفاتورة، ويُسجَّل الدفع ويُطبع الإيصال. | Services go on the patient account, the invoice is issued, the payment recorded and the receipt printed. |
| `site.home.cases.eyebrow` | لمن raclinic | Who raclinic is for |
| `site.home.cases.title` | عيادة واحدة، أو مركز، أو عدة فروع | One clinic, a center, or many branches |
| `site.home.cases.lead` | المنشأة نفسها تنمو داخل مساحة العمل نفسها: أضف تخصصات وفروعًا وأعضاء فريق دون نقل البيانات. | Your organization grows inside the same workspace: add specialties, branches and team members without moving data. |
| `site.home.cases.clinic.title` | عيادة واحدة | A single clinic |
| `site.home.cases.clinic.body` | طبيب أو أكثر في موقع واحد، بجدول واضح لكل طبيب واستقبال منظّم. | One or more doctors in one place, with a clear schedule per doctor and an organized front desk. |
| `site.home.cases.clinic.link` | حلول العيادات | Clinic solutions |
| `site.home.cases.clinic.points` | • مواعيد وقائمة انتظار<br>• سجل زيارة لكل موعد<br>• حسابات المرضى والإيصالات | • Appointments and queue<br>• A visit record for every appointment<br>• Patient accounts and receipts |
| `site.home.cases.center.title` | مركز طبي متعدد التخصصات | A multi-specialty center |
| `site.home.cases.center.body` | تخصصات مختلفة تحت سقف واحد؛ يعمل كل طبيب في تخصصه، وترى الإدارة الصورة كاملة. | Several specialties under one roof; each doctor works in their specialty while management sees the whole picture. |
| `site.home.cases.center.link` | حل المراكز الطبية | Medical centers |
| `site.home.cases.center.points` | • تفعيل أكثر من تخصص<br>• تصفية العرض حسب التخصص<br>• ملف واحد للمريض في كل الأقسام | • Several specialties enabled<br>• Views filtered by specialty<br>• One patient file across departments |
| `site.home.cases.branches.title` | منشأة متعددة الفروع | A multi-branch organization |
| `site.home.cases.branches.body` | لكل فرع تخصصاته وأسعاره، ولكل عضو في الفريق فروعه فقط. | Each branch with its own specialties and prices; each team member sees only their branches. |
| `site.home.cases.branches.link` | حل المراكز الطبية | Medical centers |
| `site.home.cases.branches.points` | • تخصصات لكل فرع<br>• صلاحيات حسب الفرع<br>• أسعار خدمات لكل فرع | • Specialties per branch<br>• Branch-scoped permissions<br>• Service prices per branch |
| `site.home.availableEyebrow` | بوضوح | Plainly |
| `site.home.plannedLink` | اقرأ الأسئلة الشائعة | Read the FAQ |
| `site.home.faqEyebrow` | أسئلة شائعة | FAQ |
| `site.home.faqMore` | كل الأسئلة الشائعة | All questions |
| `site.home.closing.title` | جاهز لتنظيم عيادتك؟ | Ready to organize your clinic? |
| `site.home.closing.body` | أنشئ مساحة العمل في خطوات قليلة وجرّبها ببيانات تجريبية، أو تواصل معنا لطلب عرض توضيحي. | Create your workspace in a few steps and try it with demo data, or contact us for a demo. |
| `site.shared` | • سجل مرضى مع البحث بالاسم أو رقم الهاتف أو رقم الملف<br>• مواعيد العمل الأسبوعية لكل طبيب، والتعديلات في أيام محددة<br>• حجز المواعيد وتغييرها وإلغاؤها دون تعارض<br>• تسجيل وصول المريض وقائمة الانتظار اليومية<br>• سجل زيارة عام يكتبه الطبيب المعالج: مسودة ثم اعتماد، مع ملاحق مؤرخة للتصحيح<br>• أسعار الخدمات والفواتير والإيصالات وأرصدة المرضى (فواتير عادية وليست ضريبية)<br>• أعداد مواعيد اليوم حسب الحالة<br>• عدة فروع، وصلاحيات حسب الدور والفرع<br>• واجهة كاملة بالعربية والإنجليزية | • Patient registry with search by name, phone number or patient number<br>• Each doctor's weekly working hours and date-specific changes<br>• Booking, rescheduling and cancellation without double booking<br>• Check-in on arrival and the daily waiting queue<br>• General visit records written by the treating doctor: draft, finalize, and dated addenda for corrections<br>• Service prices, invoices, receipts and patient balances (ordinary invoices, not tax invoices)<br>• Today's appointment counts by status<br>• Several branches, with access by role and branch<br>• Full Arabic and English interface |

## Hosted workspace vs custom project (home, solution pages, custom page)

| Key | العربية | English |
| --- | --- | --- |
| `site.compare.title` | طريقتان للعمل مع raclinic | Two ways to work with raclinic |
| `site.compare.saas.title` | مساحة عمل مستضافة (اشتراك) | Hosted workspace (subscription) |
| `site.compare.saas.body` | استخدم raclinic عبر الإنترنت، وتحصل منشأتك على مساحة عمل خاصة بها على المنصة المشتركة. | Use raclinic online. Your organization gets its own workspace on the shared platform. |
| `site.compare.saas.points` | • جاهزة للاستخدام: أعدّ منشأتك في خطوات قليلة<br>• الخصائص نفسها لكل المنشآت، مع تحسينات مستمرة<br>• ستُعلن الخطط التجارية قبل الإتاحة التجارية | • Ready to use: set up your organization in a few steps<br>• The same features for every organization, improved over time<br>• Commercial plans will be announced before commercial availability |
| `site.compare.ownership.title` | مشروع مخصص | Custom project |
| `site.compare.ownership.body` | للاحتياجات التي لا تغطيها مساحة العمل المستضافة، مثل مراكز الأشعة أو نظام تديره منشأتك بشكل منفصل. | For needs the hosted workspace does not cover, such as radiology centers or a separately run system. |
| `site.compare.ownership.points` | • يُحدَّد نطاقه لمنشأتك بعد مراجعة احتياجاتك<br>• يُتفق على النطاق والجدول الزمني وشروط الدعم والسعر لكل مشروع<br>• لا توجد أي التزامات قبل هذا الاتفاق | • Scoped for your organization after a review of your needs<br>• Scope, schedule, support terms and price agreed per project<br>• Nothing is promised before that agreement |
| `site.compare.eyebrow` | طريقتان | Two ways |
| `site.compare.lead` | اشتراك في مساحة العمل المستضافة لمعظم العيادات والمراكز، أو مشروع مخصص يُحدَّد نطاقه لاحتياجات خاصة. | A subscription to the hosted workspace for most clinics and centers, or a custom project scoped for special needs. |

## Solutions catalog (`/solutions`) and shared solution labels

| Key | العربية | English |
| --- | --- | --- |
| `site.solutions.metaTitle` | حلول للعيادات والمراكز الطبية | Solutions for clinics and medical centers |
| `site.solutions.metaDescription` | حلول raclinic لعيادات الأسنان ومراكز العلاج الطبيعي وعيادات الأنف والأذن والحنجرة والمراكز الطبية متعددة التخصصات، على مساحة عمل تشغيلية مشتركة. | raclinic solutions for dental clinics, physiotherapy centers, ENT clinics and multi-specialty medical centers, on a shared operational workspace. |
| `site.solutions.eyebrow` | الحلول | Solutions |
| `site.solutions.title` | الحلول | Solutions |
| `site.solutions.lead` | كل الحلول تعمل على مساحة العمل التشغيلية نفسها، مع نسخة أولى من أدوات كل تخصص بانتظار مراجعة أطباء ممارسين. | Every solution runs on the same operational workspace, with a first version of each specialty’s tools, pending review by practising clinicians. |
| `site.solutions.previewLabel` | اختر حلًا لمعاينته | Choose a solution to preview |
| `site.solutions.catalogTitle` | كل الحلول | All solutions |
| `site.solutions.catalogLead` | أربعة حلول على مساحة العمل المستضافة نفسها، ومسار منفصل للمشروعات المخصصة. | Four solutions on the same hosted workspace, and a separate path for custom projects. |
| `site.solutions.paper.title` | مقارنة مع الورق والجداول | Compared with paper and spreadsheets |
| `site.solutions.paper.lead` | ما يتغيّر عندما تنتقل من الدفاتر وجداول البيانات إلى مساحة عمل واحدة. | What changes when you move from notebooks and spreadsheets to one workspace. |
| `site.solutions.paper.need` | الاحتياج | Need |
| `site.solutions.paper.paperCol` | الورق والجداول | Paper and spreadsheets |
| `site.solutions.paper.rows.0.need` | منع الحجز المزدوج | Preventing double bookings |
| `site.solutions.paper.rows.0.paper` | يعتمد على الانتباه | Depends on attention |
| `site.solutions.paper.rows.0.raclinic` | يُتحقق منه لحظة التأكيد | Checked at the moment of confirmation |
| `site.solutions.paper.rows.1.need` | معرفة من وصل ومن ينتظر | Who has arrived, who is waiting |
| `site.solutions.paper.rows.1.paper` | نداء وأوراق متفرقة | Calling out, loose notes |
| `site.solutions.paper.rows.1.raclinic` | قائمة انتظار حسب ترتيب الوصول | A queue in order of arrival |
| `site.solutions.paper.rows.2.need` | ملف المريض في كل الفروع | The patient file in every branch |
| `site.solutions.paper.rows.2.paper` | نسخ مكررة | Duplicate copies |
| `site.solutions.paper.rows.2.raclinic` | ملف واحد مشترك بين الفروع | One file shared by the branches |
| `site.solutions.paper.rows.3.need` | من يرى ماذا | Who sees what |
| `site.solutions.paper.rows.3.paper` | الدفتر مفتوح للجميع | The book is open to all |
| `site.solutions.paper.rows.3.raclinic` | صلاحيات حسب الدور والفرع | Permissions by role and branch |
| `site.solutions.paper.rows.4.need` | تصحيح سجل بعد كتابته | Correcting a written record |
| `site.solutions.paper.rows.4.paper` | شطب أو إعادة كتابة | Crossing out or rewriting |
| `site.solutions.paper.rows.4.raclinic` | ملحق مؤرخ، والأصل لا يتغيّر | A dated addendum; the original stays |
| `site.solutions.paper.rows.5.need` | رصيد المريض | Patient balance |
| `site.solutions.paper.rows.5.paper` | حساب يدوي | Calculated by hand |
| `site.solutions.paper.rows.5.raclinic` | كشف حساب ورصيد لكل مريض | A statement and balance per patient |
| `site.solutions.closing.title` | لم تجد ما يناسبك تمامًا؟ | Not quite what you need? |
| `site.solutions.closing.body` | ابدأ بمساحة العمل المستضافة، أو أخبرنا عن احتياجك الخاص. | Start with the hosted workspace, or tell us about your specific needs. |
| `site.solutions.labels.audience` | لمن هذا الحل | Who it is for |
| `site.solutions.labels.needs` | احتياجات يومية يغطيها اليوم | Everyday needs it covers today |
| `site.solutions.labels.available` | المتاح اليوم في مساحة العمل المشتركة | Available today in the shared workspace |
| `site.solutions.labels.planned` | أدوات التخصص (نسخة أولى) | Specialty tools (first version) |
| `site.solutions.labels.plannedNote` | متاحة في مساحة العمل كنسخة أولى للتجربة ببيانات تجريبية، ولم يراجعها أطباء ممارسون بعد. | Available in the workspace as a first version, for trying out with synthetic data. Not yet reviewed by practising clinicians. |
| `site.solutions.labels.back` | كل الحلول | All solutions |
| `site.solutions.labels.sharedBadge` | مساحة العمل المشتركة | Shared workspace |
| `site.solutions.labels.explore` | استكشف | Explore |
| `site.solutions.labels.problemsEyebrow` | ما يواجهه فريقك | What your team faces |
| `site.solutions.labels.toolsEyebrow` | أدوات التخصص | Specialty tools |
| `site.solutions.labels.workflowEyebrow` | كيف يعمل | How it works |
| `site.solutions.labels.faqTitle` | أسئلة عن {{name}} | Questions about {{name}} |
| `site.solutions.labels.closingBody` | أنشئ مساحة العمل وجرّبها ببيانات تجريبية؛ يمكنك إضافة تخصصات وفروع لاحقًا. | Create the workspace and try it with demo data; you can add specialties and branches later. |
| `site.solutions.customCard.title` | تحتاج إلى شيء مختلف؟ | Need something different? |
| `site.solutions.customCard.body` | التخصصات المعقدة مثل الأشعة، أو نظام تديره منشأتك بنفسها، تُنفَّذ كمشروعات مخصصة يُحدَّد نطاقها بشكل منفصل. | Complex specialties such as radiology, or a system you run yourselves, are handled as separately scoped custom projects. |
| `site.solutions.customCard.badge` | مشروع مخصص | Custom project |
| `site.solutions.customCard.link` | ناقش مشروعك | Discuss your project |

## Dental clinics (`/solutions/dentistry`)

| Key | العربية | English |
| --- | --- | --- |
| `site.solutions.dentistry.name` | عيادات الأسنان | Dental clinics |
| `site.solutions.dentistry.summary` | نظّم مواعيد كل طبيب أسنان، ووصول المرضى، وبيانات التواصل في عيادات ومراكز الأسنان. | Organize each dentist's appointments, patient arrivals and contact details for dental clinics and centers. |
| `site.solutions.dentistry.metaDescription` | مواعيد لكل طبيب أسنان، وتسجيل الوصول، وقائمة الانتظار، وملفات المرضى لعيادات الأسنان في مصر والسعودية. | Appointments by dentist, check-in, the daily queue and patient records for dental clinics in Egypt and Saudi Arabia. |
| `site.solutions.dentistry.audience` | عيادات الأسنان التي يعمل بها طبيب أو أكثر، وأقسام الأسنان في المراكز الطبية. | Dental clinics with one or more dentists, and dental departments of medical centers. |
| `site.solutions.dentistry.needs` | • مواعيد بمدد مختلفة لكل طبيب أسنان<br>• حجز زيارات المتابعة دون تعارض<br>• تسجيل وصول المرضى ودخولهم حسب ترتيب الوصول | • Appointments of different lengths for each dentist<br>• Follow-up visits booked without clashes<br>• Patients checked in and seen in order of arrival |
| `site.solutions.dentistry.planned` | • مخطط الأسنان بترقيم FDI مع نتائج الفحص والإجراءات لكل زيارة<br>• بنود خطة العلاج وحالتها عبر الزيارات | • Dental chart (FDI notation) with findings and procedures per visit<br>• Treatment-plan items and their status across visits |
| `site.solutions.dentistry.tagline` | مخطط أسنان، وبنود خطة العلاج | Tooth chart and treatment-plan items |
| `site.solutions.dentistry.badge` | حل طب الأسنان | Dentistry solution |
| `site.solutions.dentistry.lead` | نظّم مواعيد كل طبيب أسنان ووصول المرضى، وسجّل لكل زيارة النتائج والإجراءات على مخطط الأسنان، وتابع بنود خطة العلاج من زيارة إلى أخرى. | Organize each dentist’s appointments and patient arrivals, record findings and procedures on the tooth chart at every visit, and follow treatment-plan items from one visit to the next. |
| `site.solutions.dentistry.highlights` | • مخطط أسنان بترقيم FDI<br>• بنود خطة علاج وحالتها عبر الزيارات<br>• مواعيد بمدد مختلفة لكل طبيب | • Tooth chart in FDI notation<br>• Treatment-plan items and their status across visits<br>• Appointments of different lengths per dentist |
| `site.solutions.dentistry.shotAlt` | لقطة حقيقية من مخطط الأسنان في raclinic، ببيانات تجريبية | A real screenshot of the raclinic tooth chart, with demo data |
| `site.solutions.dentistry.floats` | • مخطط الأسنان (FDI)<br>• خطة العلاج عبر الزيارات | • Tooth chart (FDI)<br>• Treatment plan across visits |
| `site.solutions.dentistry.problemsTitle` | ما يحدث في عيادة أسنان مزدحمة | What happens in a busy dental clinic |
| `site.solutions.dentistry.problems.0.title` | زيارات متتابعة لنفس العلاج | Treatment over several visits |
| `site.solutions.dentistry.problems.0.body` | العلاج يمتد على عدة زيارات، ويصعب تذكّر ما بقي من الخطة دون سجل واحد. | Treatment spans visits, and remembering what is left of the plan is hard without one record. |
| `site.solutions.dentistry.problems.1.title` | مدد مختلفة لكل إجراء | Different lengths per procedure |
| `site.solutions.dentistry.problems.1.body` | كشف قصير وإجراء طويل في اليوم نفسه، والجدول الورقي لا يحسب الفراغات. | A short check-up and a long procedure on the same day; a paper schedule does not see the gaps. |
| `site.solutions.dentistry.problems.2.title` | تاريخ كل سن | The history of each tooth |
| `site.solutions.dentistry.problems.2.body` | ما الذي وُجد في سن معيّنة وما الذي عُمل لها؟ إجابة تحتاج إلى تصفح ملفات قديمة. | What was found on a tooth and what was done to it? An answer that means leafing through old files. |
| `site.solutions.dentistry.problems.3.title` | أكثر من طبيب أسنان | More than one dentist |
| `site.solutions.dentistry.problems.3.body` | لكل طبيب مواعيده وأيام عمله، والاستقبال يحتاج إلى رؤيتها كلها. | Each dentist has their own hours and days, and reception needs to see all of them. |
| `site.solutions.dentistry.problems.4.title` | مرضى يعودون للمتابعة | Patients returning for follow-up |
| `site.solutions.dentistry.problems.4.body` | زيارات متابعة تحتاج إلى حجز دون تعارض مع حالات جديدة. | Follow-up visits need booking without clashing with new cases. |
| `site.solutions.dentistry.problems.5.title` | حساب المريض | The patient account |
| `site.solutions.dentistry.problems.5.body` | خدمات على عدة زيارات ودفعات جزئية تحتاج إلى رصيد واضح. | Services over several visits and partial payments need a clear balance. |
| `site.solutions.dentistry.toolsTitle` | أدوات الأسنان في سجل الزيارة | Dental tools in the visit record |
| `site.solutions.dentistry.tools.0.title` | مخطط الأسنان (FDI) | Tooth chart (FDI) |
| `site.solutions.dentistry.tools.0.body` | الفك العلوي والسفلي للأسنان الدائمة واللبنية والمختلطة. اختر سنًّا لترى تاريخها من الزيارات التي اعتُمد سجلها وتصل إليها. | Upper and lower jaw for permanent, primary and mixed dentition. Select a tooth to see its history from finalized visits you can read. |
| `site.solutions.dentistry.tools.1.title` | النتائج والإجراءات | Findings and procedures |
| `site.solutions.dentistry.tools.1.body` | سجّل نتيجة الفحص والإجراء المنفّذ لكل سن وأسطحها، بكلماتك أنت؛ النتائج السابقة لا تُستبدل. | Record the finding and the procedure performed per tooth and surface, in your own words; earlier findings are never overwritten. |
| `site.solutions.dentistry.tools.2.title` | بنود خطة العلاج | Treatment-plan items |
| `site.solutions.dentistry.tools.2.body` | أضف بنودًا للخطة وغيّر حالتها (مخطط، قيد التنفيذ، تم، أُلغي) في الزيارات التالية. | Add plan items and change their status (planned, in progress, done, cancelled) at later visits. |
| `site.solutions.dentistry.tools.3.title` | سجل الزيارة العام | The general visit record |
| `site.solutions.dentistry.tools.3.body` | سبب الزيارة والتاريخ والفحص والتقييم والخطة، كمسودة ثم اعتماد، وملاحق مؤرخة. | Reason, history, examination, assessment and plan, as a draft then finalized, with dated addenda. |
| `site.solutions.dentistry.workflowTitle` | زيارة أسنان في raclinic | A dental visit in raclinic |
| `site.solutions.dentistry.workflow.0.title` | الحجز بالمدة المناسبة | Booking the right length |
| `site.solutions.dentistry.workflow.0.body` | يحجز الاستقبال موعدًا بمدة الإجراء لدى طبيب الأسنان المناسب. | Reception books a slot as long as the procedure, with the right dentist. |
| `site.solutions.dentistry.workflow.1.title` | الوصول والانتظار | Arrival and queue |
| `site.solutions.dentistry.workflow.1.body` | يُسجَّل الوصول، ويرى الطبيب من ينتظره حسب ترتيب الوصول. | The patient is checked in; the dentist sees who is waiting, in order. |
| `site.solutions.dentistry.workflow.2.title` | المخطط والخطة | Chart and plan |
| `site.solutions.dentistry.workflow.2.body` | يسجّل الطبيب النتائج والإجراءات على المخطط ويحدّث بنود الخطة. | The dentist records findings and procedures on the chart and updates plan items. |
| `site.solutions.dentistry.workflow.3.title` | الحساب والمتابعة | Billing and follow-up |
| `site.solutions.dentistry.workflow.3.body` | تُضاف الخدمات إلى حساب المريض، ويُحجز موعد المتابعة. | Services go on the patient account, and the follow-up visit is booked. |
| `site.solutions.dentistry.faq.0.q` | هل يدعم المخطط الأسنان اللبنية؟ | Does the chart support primary teeth? |
| `site.solutions.dentistry.faq.0.a` | نعم. يدعم المخطط الأسنان الدائمة واللبنية والمختلطة بترقيم FDI. | Yes. The chart supports permanent, primary and mixed dentition in FDI notation. |
| `site.solutions.dentistry.faq.1.q` | هل يمكن تعديل نتيجة سابقة على سن؟ | Can an earlier finding on a tooth be changed? |
| `site.solutions.dentistry.faq.1.a` | لا تُستبدل النتائج السابقة؛ يُسجَّل الجديد في زيارة جديدة، وتصحيح السجل بعد اعتماده يكون بملحق مؤرخ. | Earlier findings are never overwritten; new ones go in a new visit, and a finalized record is corrected with a dated addendum. |
| `site.solutions.dentistry.faq.2.q` | هل راجع أطباء أسنان هذه الأدوات؟ | Have dentists reviewed these tools? |
| `site.solutions.dentistry.faq.2.a` | ليس بعد. هي نسخة أولى بانتظار مراجعة أطباء ممارسين، وتُستخدم الآن ببيانات تجريبية فقط. | Not yet. They are a first version awaiting review by practicing clinicians, and are used with demo data only for now. |
| `site.solutions.dentistry.closingTitle` | جاهز لتنظيم عيادة الأسنان؟ | Ready to organize your dental clinic? |

## Physiotherapy centers (`/solutions/physiotherapy`)

| Key | العربية | English |
| --- | --- | --- |
| `site.solutions.physiotherapy.name` | مراكز العلاج الطبيعي | Physiotherapy centers |
| `site.solutions.physiotherapy.summary` | رتّب الجلسات المتكررة لكل أخصائي، وفي أكثر من فرع، بجدول يومي واضح. | Plan recurring sessions per therapist, across branches, with a clear daily schedule. |
| `site.solutions.physiotherapy.metaDescription` | حجز الجلسات لكل أخصائي، وعدة فروع، وتسجيل الوصول، وقائمة الانتظار لمراكز العلاج الطبيعي. | Session booking per therapist, several branches, check-in and the daily queue for physiotherapy centers. |
| `site.solutions.physiotherapy.audience` | مراكز العلاج الطبيعي وأقسام التأهيل التي يعمل بها أخصائي أو أكثر. | Physiotherapy centers and rehabilitation departments with one or more therapists. |
| `site.solutions.physiotherapy.needs` | • جلسات متكررة مع الأخصائي نفسه<br>• أخصائيون يعملون في أكثر من فرع<br>• جدول واضح لكل أخصائي ولكل يوم | • Repeated sessions with the same therapist<br>• Therapists working at more than one branch<br>• A clear schedule for each therapist and day |
| `site.solutions.physiotherapy.planned` | • تقييم أولي بأهداف وعدد جلسات مخطط<br>• ملاحظات الجلسات مرتبطة بالمواعيد الفعلية، وملخص إنهاء العلاج | • Initial assessment with goals and planned sessions<br>• Session notes linked to real appointments, and a discharge summary |
| `site.solutions.physiotherapy.tagline` | تقييم أولي، ومسار جلسات، وملخص إنهاء | Assessment, course of sessions, discharge summary |
| `site.solutions.physiotherapy.badge` | حل العلاج الطبيعي | Physiotherapy solution |
| `site.solutions.physiotherapy.lead` | رتّب الجلسات المتكررة لكل أخصائي وفي أكثر من فرع، وابدأ كل مسار علاج بتقييم أولي بأهداف وعدد جلسات، وتابع ما وُثّق من الجلسات حتى ملخص الإنهاء. | Arrange recurring sessions per therapist across branches, start every course with an initial assessment with goals and a number of sessions, and follow the documented sessions through to the discharge summary. |
| `site.solutions.physiotherapy.highlights` | • تقييم أولي بأهداف وعدد جلسات مخطط<br>• جلسات مرتبطة بالمواعيد الفعلية<br>• ملخص إنهاء العلاج | • Initial assessment with goals and planned sessions<br>• Sessions linked to real appointments<br>• Discharge summary |
| `site.solutions.physiotherapy.shotAlt` | لقطة حقيقية من مسار علاج طبيعي في raclinic، ببيانات تجريبية | A real screenshot of a raclinic physiotherapy course, with demo data |
| `site.solutions.physiotherapy.floats` | • مسار الجلسات<br>• الأهداف وملاحظاتها | • Course of sessions<br>• Goals and notes |
| `site.solutions.physiotherapy.problemsTitle` | ما يحدث في مركز علاج طبيعي | What happens in a physiotherapy center |
| `site.solutions.physiotherapy.problems.0.title` | جلسات متكررة | Recurring sessions |
| `site.solutions.physiotherapy.problems.0.body` | المريض يأتي مرتين أو ثلاثًا في الأسبوع، مع الأخصائي نفسه غالبًا. | Patients come two or three times a week, usually with the same therapist. |
| `site.solutions.physiotherapy.problems.1.title` | كم جلسة بقيت؟ | How many sessions are left? |
| `site.solutions.physiotherapy.problems.1.body` | معرفة ما وُثّق من الجلسات المخططة يحتاج إلى عدّ يدوي. | Knowing how many planned sessions are documented means counting by hand. |
| `site.solutions.physiotherapy.problems.2.title` | أخصائيون في عدة فروع | Therapists in several branches |
| `site.solutions.physiotherapy.problems.2.body` | الأخصائي نفسه يعمل في فرعين، والجدول يجب أن يعرف ذلك. | The same therapist works in two branches, and the schedule must know. |
| `site.solutions.physiotherapy.problems.3.title` | أهداف العلاج | Treatment goals |
| `site.solutions.physiotherapy.problems.3.body` | أهداف المسار تضيع بين الجلسات إن لم تُكتب في مكان واحد. | Course goals get lost between sessions unless they are written in one place. |
| `site.solutions.physiotherapy.problems.4.title` | إنهاء العلاج | Discharge |
| `site.solutions.physiotherapy.problems.4.body` | ملخص الإنهاء يُكتب متأخرًا أو لا يُكتب. | The discharge summary is written late, or not at all. |
| `site.solutions.physiotherapy.problems.5.title` | الحساب على عدة جلسات | Billing over many sessions |
| `site.solutions.physiotherapy.problems.5.body` | جلسات كثيرة ودفعات جزئية تحتاج إلى رصيد واضح. | Many sessions and partial payments need a clear balance. |
| `site.solutions.physiotherapy.toolsTitle` | أدوات العلاج الطبيعي في سجل الزيارة | Physiotherapy tools in the visit record |
| `site.solutions.physiotherapy.tools.0.title` | التقييم الأولي | Initial assessment |
| `site.solutions.physiotherapy.tools.0.body` | القيود الوظيفية كما تقيّمها (دون مقاييس محسوبة)، والأهداف، وعدد الجلسات المخطط وتكرارها. | Functional limitations as you assess them (no calculated scores), goals, and planned sessions and frequency. |
| `site.solutions.physiotherapy.tools.1.title` | مسار العلاج | Treatment course |
| `site.solutions.physiotherapy.tools.1.body` | الجلسات هي مواعيدك الحقيقية؛ يربط السجل كل جلسة بمسارها ويعرض ما وُثّق من المخطط. | Sessions are your real appointments; the record links each to its course and shows how many are documented. |
| `site.solutions.physiotherapy.tools.2.title` | الجلسة | Session |
| `site.solutions.physiotherapy.tools.2.body` | العلاج المنفَّذ والتقدّم، وملاحظات لكل هدف. | Treatment performed and progress, with notes per goal. |
| `site.solutions.physiotherapy.tools.3.title` | ملخص الإنهاء | Discharge summary |
| `site.solutions.physiotherapy.tools.3.body` | يُكتب عند إنهاء المسار، ولا يُعتمد السجل دونه. | Written when the course ends; the record cannot be finalized without it. |
| `site.solutions.physiotherapy.workflowTitle` | مسار علاج طبيعي في raclinic | A physiotherapy course in raclinic |
| `site.solutions.physiotherapy.workflow.0.title` | التقييم | Assessment |
| `site.solutions.physiotherapy.workflow.0.body` | زيارة أولى بتقييم وأهداف وعدد جلسات مخطط. | A first visit with an assessment, goals and planned sessions. |
| `site.solutions.physiotherapy.workflow.1.title` | حجز الجلسات | Booking sessions |
| `site.solutions.physiotherapy.workflow.1.body` | يحجز الاستقبال الجلسات مع الأخصائي نفسه، في الفرع المناسب. | Reception books sessions with the same therapist, in the right branch. |
| `site.solutions.physiotherapy.workflow.2.title` | توثيق كل جلسة | Documenting each session |
| `site.solutions.physiotherapy.workflow.2.body` | يكتب الأخصائي ما نُفّذ والتقدّم وملاحظات الأهداف. | The therapist writes what was done, progress and goal notes. |
| `site.solutions.physiotherapy.workflow.3.title` | الإنهاء | Discharge |
| `site.solutions.physiotherapy.workflow.3.body` | ملخص إنهاء يغلق المسار، والحساب يوضح الرصيد. | A discharge summary closes the course; the account shows the balance. |
| `site.solutions.physiotherapy.faq.0.q` | هل يحسب raclinic درجات أو مقاييس؟ | Does raclinic calculate scores or scales? |
| `site.solutions.physiotherapy.faq.0.a` | لا. القيود والتقدّم يكتبها الأخصائي بكلماته؛ لا تُحسب درجات ولا مقاييس. | No. Limitations and progress are written by the therapist; no scores or scales are calculated. |
| `site.solutions.physiotherapy.faq.1.q` | هل يعمل الأخصائي في أكثر من فرع؟ | Can a therapist work in more than one branch? |
| `site.solutions.physiotherapy.faq.1.a` | نعم. تحدَّد مواعيد عمله لكل فرع، وتُحجز جلساته حيث يعمل. | Yes. Their hours are set per branch, and their sessions are booked where they work. |
| `site.solutions.physiotherapy.faq.2.q` | هل راجع أخصائيون هذه الأدوات؟ | Have physiotherapists reviewed these tools? |
| `site.solutions.physiotherapy.faq.2.a` | ليس بعد. هي نسخة أولى بانتظار مراجعة ممارسين، وتُستخدم الآن ببيانات تجريبية فقط. | Not yet. They are a first version awaiting review by practitioners, used with demo data only for now. |
| `site.solutions.physiotherapy.closingTitle` | جاهز لتنظيم مركز العلاج الطبيعي؟ | Ready to organize your physiotherapy center? |

## ENT clinics (`/solutions/ent`)

| Key | العربية | English |
| --- | --- | --- |
| `site.solutions.ent.name` | عيادات الأنف والأذن والحنجرة | ENT clinics |
| `site.solutions.ent.summary` | كشوفات قصيرة، وغرفة انتظار مزدحمة، وزيارات متابعة — منظمة في مكان واحد. | Short consultations, busy waiting rooms and follow-up visits, organized in one place. |
| `site.solutions.ent.metaDescription` | المواعيد وتسجيل الوصول وقائمة الانتظار وملفات المرضى لعيادات الأنف والأذن والحنجرة. | Appointments, check-in, the waiting queue and patient records for ear, nose and throat clinics. |
| `site.solutions.ent.audience` | عيادات الأنف والأذن والحنجرة وأقسامها في المراكز الطبية. | Ear, nose and throat clinics and ENT departments of medical centers. |
| `site.solutions.ent.needs` | • مواعيد كشف قصيرة<br>• غرفة انتظار مزدحمة تُدار حسب ترتيب الوصول<br>• مرضى يعودون للمتابعة | • Short consultation slots<br>• A busy waiting room handled in order of arrival<br>• Patients returning for follow-up |
| `site.solutions.ent.planned` | • التاريخ المرضي والفحص حسب المنطقة للأنف والأذن والحنجرة، مع المتابعة | • Ear, nose and throat history and examination by region, with follow-up |
| `site.solutions.ent.tagline` | تاريخ وفحص حسب المنطقة، ومتابعة | History and examination by region, follow-up |
| `site.solutions.ent.badge` | حل الأنف والأذن والحنجرة | ENT solution |
| `site.solutions.ent.lead` | كشوفات قصيرة وغرفة انتظار مزدحمة وزيارات متابعة، في مكان واحد: سجّل التاريخ المرضي والفحص لكل منطقة — الأذن اليمنى واليسرى والأنف والحلق والرقبة — وتعليمات المتابعة. | Short consultations, a busy waiting room and follow-ups, in one place: record history and examination per region — right and left ear, nose, throat and neck — and follow-up instructions. |
| `site.solutions.ent.highlights` | • تاريخ مرضي حسب الأذن والأنف والحلق<br>• فحص لكل منطقة، يمينًا ويسارًا<br>• تعليمات المتابعة | • History by ear, nose and throat<br>• Examination per region, right and left<br>• Follow-up instructions |
| `site.solutions.ent.shotAlt` | لقطة حقيقية من فحص الأنف والأذن والحنجرة في raclinic، ببيانات تجريبية | A real screenshot of the raclinic ENT examination, with demo data |
| `site.solutions.ent.floats` | • فحص حسب المنطقة<br>• تعليمات المتابعة | • Examination by region<br>• Follow-up instructions |
| `site.solutions.ent.problemsTitle` | ما يحدث في عيادة أنف وأذن وحنجرة | What happens in an ENT clinic |
| `site.solutions.ent.problems.0.title` | كشوفات قصيرة كثيرة | Many short consultations |
| `site.solutions.ent.problems.0.body` | مواعيد قصيرة متتابعة، وأي تأخير يتراكم على بقية اليوم. | Short appointments back to back; any delay piles up for the rest of the day. |
| `site.solutions.ent.problems.1.title` | غرفة انتظار مزدحمة | A busy waiting room |
| `site.solutions.ent.problems.1.body` | من وصل أولًا؟ الدخول بترتيب الوصول يحتاج إلى قائمة واضحة. | Who arrived first? Seeing patients in order of arrival needs a clear list. |
| `site.solutions.ent.problems.2.title` | يمين أم يسار؟ | Right or left? |
| `site.solutions.ent.problems.2.body` | فحص الأذنين يحتاج إلى تسجيل منفصل لكل جانب. | Examining the ears means recording each side separately. |
| `site.solutions.ent.problems.3.title` | المتابعة | Follow-up |
| `site.solutions.ent.problems.3.body` | مرضى يعودون بعد أيام، ويحتاج الطبيب إلى ما كتبه في المرة السابقة. | Patients return days later, and the doctor needs what was written last time. |
| `site.solutions.ent.problems.4.title` | أكثر من طبيب | More than one doctor |
| `site.solutions.ent.problems.4.body` | كل طبيب بجدوله، والاستقبال يرى الجميع. | Each doctor has their own schedule; reception sees all of them. |
| `site.solutions.ent.problems.5.title` | حساب المريض | The patient account |
| `site.solutions.ent.problems.5.body` | كشف وإجراء في الزيارة نفسها يحتاجان إلى فاتورة واضحة. | A consultation and a procedure in the same visit need a clear invoice. |
| `site.solutions.ent.toolsTitle` | أدوات الأنف والأذن والحنجرة في سجل الزيارة | ENT tools in the visit record |
| `site.solutions.ent.tools.0.title` | التاريخ حسب المنطقة | History by region |
| `site.solutions.ent.tools.0.body` | تاريخ مرضي منفصل للأذن والأنف والحلق. | Separate history for ear, nose and throat. |
| `site.solutions.ent.tools.1.title` | الفحص حسب المنطقة | Examination by region |
| `site.solutions.ent.tools.1.body` | الأذن اليمنى، والأذن اليسرى، والأنف، والحلق، والرقبة — كل منها في حقله. | Right ear, left ear, nose, throat and neck — each in its own field. |
| `site.solutions.ent.tools.2.title` | تعليمات المتابعة | Follow-up instructions |
| `site.solutions.ent.tools.2.body` | ما يجب أن يفعله المريض حتى زيارته التالية. | What the patient should do until the next visit. |
| `site.solutions.ent.tools.3.title` | سجل الزيارة العام | The general visit record |
| `site.solutions.ent.tools.3.body` | سبب الزيارة والتقييم والخطة، كمسودة ثم اعتماد، وملاحق مؤرخة. | Reason, assessment and plan, as a draft then finalized, with dated addenda. |
| `site.solutions.ent.workflowTitle` | زيارة أنف وأذن وحنجرة في raclinic | An ENT visit in raclinic |
| `site.solutions.ent.workflow.0.title` | حجز قصير | A short booking |
| `site.solutions.ent.workflow.0.body` | موعد كشف قصير لدى الطبيب المناسب دون تعارض. | A short consultation slot with the right doctor, without clashes. |
| `site.solutions.ent.workflow.1.title` | الدخول بالترتيب | Seen in order |
| `site.solutions.ent.workflow.1.body` | قائمة انتظار حسب ترتيب الوصول. | A waiting queue in order of arrival. |
| `site.solutions.ent.workflow.2.title` | الفحص حسب المنطقة | Examination by region |
| `site.solutions.ent.workflow.2.body` | تاريخ وفحص لكل منطقة، وتعليمات المتابعة. | History and examination per region, and follow-up instructions. |
| `site.solutions.ent.workflow.3.title` | المتابعة والحساب | Follow-up and billing |
| `site.solutions.ent.workflow.3.body` | موعد متابعة، والخدمات على حساب المريض. | A follow-up appointment, and the services on the patient account. |
| `site.solutions.ent.faq.0.q` | هل يدعم raclinic تخطيط السمع أو الأجهزة؟ | Does raclinic support audiometry or devices? |
| `site.solutions.ent.faq.0.a` | لا. لا توجد أدوات قياس أو ربط بأجهزة؛ يكتب الطبيب التاريخ والفحص بكلماته. | No. There are no measurement tools or device connections; the doctor writes history and examination. |
| `site.solutions.ent.faq.1.q` | هل يمكن رؤية زيارة المتابعة السابقة؟ | Can the previous follow-up visit be seen? |
| `site.solutions.ent.faq.1.a` | نعم، للطبيب المعالج ولمن يشاركه السجل صراحةً. | Yes, by the treating doctor and anyone the record is explicitly shared with. |
| `site.solutions.ent.faq.2.q` | هل راجع أطباء هذه الأدوات؟ | Have doctors reviewed these tools? |
| `site.solutions.ent.faq.2.a` | ليس بعد. هي نسخة أولى بانتظار مراجعة أطباء ممارسين، وتُستخدم الآن ببيانات تجريبية فقط. | Not yet. They are a first version awaiting review by practicing clinicians, used with demo data only for now. |
| `site.solutions.ent.closingTitle` | جاهز لتنظيم عيادة الأنف والأذن والحنجرة؟ | Ready to organize your ENT clinic? |

## Multi-specialty medical centers (`/solutions/medical-centers`)

| Key | العربية | English |
| --- | --- | --- |
| `site.solutions.medicalCenters.name` | المراكز الطبية متعددة التخصصات | Multi-specialty medical centers |
| `site.solutions.medicalCenters.summary` | أدِر عدة تخصصات وفروع في منشأة واحدة، ويقدم كل فرع التخصصات التي تختارها. | Run several specialties and branches in one organization; each branch offers the specialties you choose. |
| `site.solutions.medicalCenters.metaDescription` | مساحة عمل واحدة للمراكز الطبية متعددة التخصصات: تخصصات لكل فرع، وملف مريض مشترك، وصلاحيات حسب الدور. | One workspace for multi-specialty medical centers: specialties per branch, shared patient records and role-based access. |
| `site.solutions.medicalCenters.audience` | المراكز والمجموعات الطبية التي تقدم عدة تخصصات، في موقع واحد أو عدة فروع. | Medical centers and groups that offer several specialties, at one location or several branches. |
| `site.solutions.medicalCenters.needs` | • تخصصات مختلفة في فروع مختلفة<br>• ملف واحد للمريض في كل الفروع<br>• وصول كل عضو في الفريق إلى فروعه فقط | • Different specialties at different branches<br>• One patient record across the branches<br>• Each team member limited to their own branches |
| `site.solutions.medicalCenters.planned` | • أدوات التخصصات السابقة، حسب تخصص كل طبيب | • The specialty tools above, for each doctor’s specialty |
| `site.solutions.medicalCenters.tagline` | عدة تخصصات وفروع في منشأة واحدة | Several specialties and branches in one organization |
| `site.solutions.medicalCenters.badge` | حل المراكز الطبية | Medical centers solution |
| `site.solutions.medicalCenters.lead` | أدِر عدة تخصصات وفروع في مساحة عمل واحدة: يقدّم كل فرع التخصصات التي تختارها، ويشترك المريض في ملف واحد، ويرى كل عضو في الفريق فروعه وما يسمح به دوره فقط. | Run several specialties and branches in one workspace: each branch offers the specialties you choose, patients share one file, and every team member sees only their branches and what their role allows. |
| `site.solutions.medicalCenters.highlights` | • تخصصات مختلفة لكل فرع<br>• ملف واحد للمريض في كل الفروع<br>• صلاحيات حسب الدور والفرع | • Different specialties per branch<br>• One patient file across branches<br>• Permissions by role and branch |
| `site.solutions.medicalCenters.shotAlt` | لقطة حقيقية من عرض المواعيد لسبعة أيام في raclinic، ببيانات تجريبية | A real screenshot of the raclinic 7-day appointments view, with demo data |
| `site.solutions.medicalCenters.floats` | • عدة فروع<br>• تصفية حسب التخصص | • Several branches<br>• Filter by specialty |
| `site.solutions.medicalCenters.problemsTitle` | ما يحدث في مركز متعدد التخصصات | What happens in a multi-specialty center |
| `site.solutions.medicalCenters.problems.0.title` | تخصصات في فروع مختلفة | Specialties in different branches |
| `site.solutions.medicalCenters.problems.0.body` | الأسنان في فرع، والعلاج الطبيعي في آخر، وبعض الأطباء في الاثنين. | Dentistry in one branch, physiotherapy in another, some doctors in both. |
| `site.solutions.medicalCenters.problems.1.title` | ملفات مكررة | Duplicate files |
| `site.solutions.medicalCenters.problems.1.body` | المريض نفسه بملف في كل قسم أو فرع. | The same patient with a file in every department or branch. |
| `site.solutions.medicalCenters.problems.2.title` | من يرى ماذا | Who sees what |
| `site.solutions.medicalCenters.problems.2.body` | الاستقبال في فرع لا يحتاج إلى رؤية فرع آخر، والمحاسب لا يحتاج إلى السجلات الطبية. | Reception in one branch does not need another branch; accountants do not need medical records. |
| `site.solutions.medicalCenters.problems.3.title` | صورة كاملة للإدارة | The full picture for management |
| `site.solutions.medicalCenters.problems.3.body` | الإدارة تريد أعداد اليوم في كل الفروع دون الدخول إلى التفاصيل السريرية. | Management wants today’s counts in every branch without clinical details. |
| `site.solutions.medicalCenters.problems.4.title` | أسعار لكل فرع | Prices per branch |
| `site.solutions.medicalCenters.problems.4.body` | الخدمة نفسها قد يختلف سعرها بين الفروع. | The same service may cost differently between branches. |
| `site.solutions.medicalCenters.problems.5.title` | فريق يتغيّر | A changing team |
| `site.solutions.medicalCenters.problems.5.body` | إضافة عضو جديد أو إيقافه يجب أن تكون سريعة وواضحة. | Adding or suspending a member must be quick and clear. |
| `site.solutions.medicalCenters.toolsTitle` | ما يقدمه raclinic للمراكز | What raclinic gives centers |
| `site.solutions.medicalCenters.tools.0.title` | تخصصات المنشأة والفروع | Organization and branch specialties |
| `site.solutions.medicalCenters.tools.0.body` | فعّل تخصصات المنشأة، واختر ما يقدمه كل فرع منها، ويتبع الأطباء تخصصاتهم. | Enable the organization’s specialties, choose which each branch offers; doctors follow their specialties. |
| `site.solutions.medicalCenters.tools.1.title` | سياق التخصص | Specialty context |
| `site.solutions.medicalCenters.tools.1.body` | صفِّ المواعيد وقائمة الانتظار حسب التخصص، دون أن تتغيّر صلاحيات أحد. | Filter appointments and the queue by specialty, without changing anyone’s permissions. |
| `site.solutions.medicalCenters.tools.2.title` | الفريق والأدوار | Team and roles |
| `site.solutions.medicalCenters.tools.2.body` | ستة أدوار، ولكل عضو فروعه؛ إضافة وتعديل وإيقاف من صفحة الفريق. | Six roles, each member with their branches; add, change and suspend from the team page. |
| `site.solutions.medicalCenters.tools.3.title` | أدوات كل تخصص | Tools per specialty |
| `site.solutions.medicalCenters.tools.3.body` | أدوات الأسنان والعلاج الطبيعي والأنف والأذن والحنجرة لكل طبيب حسب تخصصه. | Dental, physiotherapy and ENT tools for each doctor according to their specialty. |
| `site.solutions.medicalCenters.workflowTitle` | إعداد مركز في raclinic | Setting up a center in raclinic |
| `site.solutions.medicalCenters.workflow.0.title` | المنشأة | Organization |
| `site.solutions.medicalCenters.workflow.0.body` | عرّف المركز ومنطقته الزمنية وتخصصاته. | Define the center, its time zone and specialties. |
| `site.solutions.medicalCenters.workflow.1.title` | الفروع | Branches |
| `site.solutions.medicalCenters.workflow.1.body` | أضف الفروع، واختر تخصصات كل فرع. | Add branches and choose each branch’s specialties. |
| `site.solutions.medicalCenters.workflow.2.title` | الفريق | Team |
| `site.solutions.medicalCenters.workflow.2.body` | أضف الأطباء والاستقبال والمحاسبين، ولكل منهم فروعه. | Add doctors, reception and accountants, each with their branches. |
| `site.solutions.medicalCenters.workflow.3.title` | التشغيل | Running |
| `site.solutions.medicalCenters.workflow.3.body` | المواعيد والانتظار والسجلات والحسابات لكل الفروع. | Appointments, queue, records and finance across branches. |
| `site.solutions.medicalCenters.faq.0.q` | هل يمكن إضافة فرع لاحقًا؟ | Can a branch be added later? |
| `site.solutions.medicalCenters.faq.0.a` | نعم. يضيف المالك أو المدير الفروع وتخصصاتها في أي وقت. | Yes. The owner or an admin adds branches and their specialties at any time. |
| `site.solutions.medicalCenters.faq.1.q` | هل يرى المحاسب السجلات الطبية؟ | Do accountants see medical records? |
| `site.solutions.medicalCenters.faq.1.a` | لا. الأدوار المالية والإدارية لا ترى محتوى السجلات السريرية. | No. Financial and administrative roles never see clinical record content. |
| `site.solutions.medicalCenters.faq.2.q` | هل يمكن لعضو أن يعمل في فرعين فقط؟ | Can a member work in only two branches? |
| `site.solutions.medicalCenters.faq.2.a` | نعم. يُحدَّد لكل عضو الفروع التي يصل إليها. | Yes. Each member is given the branches they can access. |
| `site.solutions.medicalCenters.closingTitle` | جاهز لتنظيم مركزك الطبي؟ | Ready to organize your medical center? |

## Custom projects (`/custom-solutions`)

| Key | العربية | English |
| --- | --- | --- |
| `site.custom.metaTitle` | مشروعات أنظمة مخصصة للعيادات | Custom clinic system projects |
| `site.custom.metaDescription` | اطلب من raclinic مشروعًا مخصصًا يُحدَّد نطاقه بشكل منفصل، مثل نظام لمركز أشعة، عندما لا تناسبك مساحة العمل المستضافة. | Request a separately scoped custom project from raclinic — for example for a radiology center — when the hosted workspace does not fit. |
| `site.custom.title` | المشروعات المخصصة | Custom projects |
| `site.custom.lead` | عندما لا تناسبك مساحة العمل المستضافة — مثل مراكز الأشعة، أو منشأة تريد نظامًا تديره بشكل منفصل — يمكنك طلب مشروع مخصص. | When the hosted workspace does not fit — for example a radiology center, or an organization that wants a separately run system — you can request a custom project. |
| `site.custom.differenceTitle` | ما الفرق عن مساحة العمل المستضافة | How it differs from the hosted workspace |
| `site.custom.processTitle` | ماذا يحدث بعد إرسال الطلب | What happens after you send a request |
| `site.custom.process` | • يُحفظ طلبك برقم مرجعي.<br>• يراجعه فريق raclinic.<br>• إذا كان من الممكن مناقشة مشروع مخصص، يُتواصل معك عبر البيانات التي قدمتها. | • Your request is saved with a reference number.<br>• The raclinic team reviews it.<br>• If a custom project can be discussed, you are contacted through the details you gave. |
| `site.custom.noPromise` | إرسال الطلب لا يعني الاتفاق على مشروع، ولا يتضمن هذا الموقع أي التزام بموعد تسليم أو نقل للشفرة المصدرية أو شروط دعم أو سعر. | Sending a request does not create an agreement. No delivery date, source-code transfer, support terms or price is promised on this site. |
| `site.custom.seeSaas` | مساحة العمل المستضافة | The hosted workspace |
| `site.custom.forTitle` | لمن المشروعات المخصصة | Who custom projects are for |
| `site.custom.forPoints` | • مراكز الأشعة وما شابهها من تخصصات معقدة<br>• منشآت تريد نظامًا تديره بشكل منفصل<br>• احتياجات لا تغطيها مساحة العمل المستضافة | • Radiology centers and similarly complex specialties<br>• Organizations that want a separately run system<br>• Needs the hosted workspace does not cover |
| `site.custom.usesEyebrow` | أمثلة | Examples |
| `site.custom.usesTitle` | متى يكون المشروع المخصص مناسبًا | When a custom project fits |
| `site.custom.uses.0.title` | مراكز الأشعة | Radiology centers |
| `site.custom.uses.0.body` | تخصص بسير عمل مختلف، يُناقش كمشروع منفصل وليس كحل اشتراك. | A specialty with a different workflow, discussed as a separate project, not a subscription. |
| `site.custom.uses.1.title` | نظام تديره منشأتك | A system your organization runs |
| `site.custom.uses.1.body` | عندما تحتاج المنشأة إلى نظام خاص بها بدل المنصة المشتركة. | When the organization needs its own system instead of the shared platform. |
| `site.custom.uses.2.title` | احتياجات خاصة | Specific requirements |
| `site.custom.uses.2.body` | متطلبات لا تغطيها مساحة العمل اليوم، يُحدَّد نطاقها بعد مراجعتها. | Needs the workspace does not cover today, scoped after review. |
| `site.custom.processEyebrow` | الخطوات | The steps |
| `site.custom.steps.0.title` | أرسل الطلب | Send the request |
| `site.custom.steps.0.body` | أخبرنا عن منشأتك واحتياجك؛ يُحفظ الطلب برقم مرجعي. | Tell us about your organization and needs; it is stored with a reference. |
| `site.custom.steps.1.title` | المراجعة | Review |
| `site.custom.steps.1.body` | يراجع فريق raclinic الطلب. | The raclinic team reviews the request. |
| `site.custom.steps.2.title` | النقاش | Discussion |
| `site.custom.steps.2.body` | إن أمكن مناقشة مشروع، نتواصل معك عبر البيانات التي قدمتها. | If a project can be discussed, we contact you using the details you gave. |
| `site.custom.steps.3.title` | اتفاق منفصل | A separate agreement |
| `site.custom.steps.3.body` | النطاق والجدول والدعم والسعر تُحدَّد في اتفاق خاص بكل مشروع. | Scope, schedule, support and price are set in an agreement for each project. |
| `site.custom.faqTitle` | أسئلة عن المشروعات المخصصة | Questions about custom projects |
| `site.custom.faq.0.q` | هل الأشعة متاحة في مساحة العمل المستضافة؟ | Is radiology available in the hosted workspace? |
| `site.custom.faq.0.a` | لا. الأشعة تُناقش فقط كمشروع مخصص منفصل. | No. Radiology is discussed only as a separate custom project. |
| `site.custom.faq.1.q` | هل يعني إرسال الطلب أن المشروع سيُنفَّذ؟ | Does sending a request mean the project will happen? |
| `site.custom.faq.1.a` | لا. إرسال الطلب لا يعني الاتفاق على مشروع ولا أي التزام. | No. Sending a request is not an agreement and creates no commitment. |
| `site.custom.faq.2.q` | هل أحصل على رد تلقائي بالبريد؟ | Will I get an automatic email? |
| `site.custom.faq.2.a` | لا يُرسل بريد تلقائي؛ يظهر لك رقم مرجعي، ونتواصل معك عبر البيانات التي قدمتها. | No automatic email is sent; you get a reference, and we contact you using the details you gave. |
| `site.custom.closingTitle` | لديك مشروع مختلف؟ | Have a different project? |
| `site.custom.closingBody` | أخبرنا عنه؛ لا التزام قبل اتفاق منفصل. | Tell us about it; there is no commitment before a separate agreement. |

## Custom-project request form (`/custom-solutions/request`)

| Key | العربية | English |
| --- | --- | --- |
| `site.inquiry.metaTitle` | اطلب مشروعًا مخصصًا | Request a custom project |
| `site.inquiry.metaDescription` | أخبر raclinic عن منشأتك واحتياجاتك من مشروع نظام مخصص للعيادات. | Tell raclinic about your organization and what you need from a custom clinic system project. |
| `site.inquiry.title` | اطلب مشروعًا مخصصًا | Request a custom project |
| `site.inquiry.lead` | أخبرنا عن منشأتك وما تحتاج إليه. جميع الحقول مطلوبة ما لم يُذكر أنها اختيارية. | Tell us about your organization and what you need. Fields are required unless marked optional. |
| `site.inquiry.privacy` | لا تكتب في هذا النموذج أسماء مرضى أو سجلات طبية أو أي بيانات خاصة بالمرضى. | Do not include patient names, medical records or any other patient information in this form. |
| `site.inquiry.contactName` | اسمك | Your name |
| `site.inquiry.organizationName` | اسم المنشأة | Organization name |
| `site.inquiry.country` | الدولة | Country |
| `site.inquiry.countries.EG` | مصر | Egypt |
| `site.inquiry.countries.SA` | السعودية | Saudi Arabia |
| `site.inquiry.countries.other` | دولة أخرى | Another country |
| `site.inquiry.organizationType` | نوع المنشأة | Type of organization |
| `site.inquiry.types.clinic` | عيادة واحدة | A single clinic |
| `site.inquiry.types.medical_center` | مركز طبي متعدد التخصصات | A medical center with several specialties |
| `site.inquiry.types.multi_branch` | منشأة متعددة الفروع | An organization with several branches |
| `site.inquiry.types.other` | أخرى | Other |
| `site.inquiry.contactTitle` | طريقة التواصل معك | How to contact you |
| `site.inquiry.contactHint` | اكتب رقم هاتف أو بريدًا إلكترونيًا أو كليهما. | Give a phone number, an email address, or both. |
| `site.inquiry.phoneCountry` | دولة رقم الهاتف | Phone country |
| `site.inquiry.phone` | رقم الهاتف | Phone number |
| `site.inquiry.email` | البريد الإلكتروني | Email |
| `site.inquiry.interest` | ما الذي تهتم به؟ | What are you interested in? |
| `site.inquiry.interests.dentistry` | طب الأسنان | Dentistry |
| `site.inquiry.interests.physiotherapy` | العلاج الطبيعي | Physiotherapy |
| `site.inquiry.interests.ent` | الأنف والأذن والحنجرة | Ear, nose and throat |
| `site.inquiry.interests.multi_specialty` | عدة تخصصات معًا | Several specialties together |
| `site.inquiry.interests.custom` | نظام مخصص (مثل الأشعة) | A custom system (for example radiology) |
| `site.inquiry.description` | اشرح ما تحتاج إليه | Describe what you need |
| `site.inquiry.descriptionHint` | من 10 إلى 1500 حرف، دون أي بيانات للمرضى. | 10 to 1,500 characters. No patient information. |
| `site.inquiry.submit` | إرسال الطلب | Send request |
| `site.inquiry.submitting` | جارٍ الإرسال… | Sending… |
| `site.inquiry.successTitle` | تم استلام الطلب | Request received |
| `site.inquiry.successBody` | حُفظ طلبك بالرقم المرجعي {{reference}}. احتفظ به إذا تواصلت معنا بشأن الطلب. | Your request was saved with reference {{reference}}. Keep this reference if you contact us about it. |
| `site.inquiry.another` | إرسال طلب آخر | Send another request |
| `site.inquiry.backHome` | العودة إلى الصفحة الرئيسية | Back to the home page |

## Product tour (`/tour`)

| Key | العربية | English |
| --- | --- | --- |
| `site.tour.metaTitle` | جولة في raclinic | raclinic product tour |
| `site.tour.metaDescription` | لقطات حقيقية من مساحة عمل raclinic ببيانات تجريبية: المواعيد، والمرضى، وسجل الزيارة، وأدوات التخصص، والحسابات. | Real screenshots of the raclinic workspace with demo data: appointments, patients, visit records, specialty tools and finance. |
| `site.tour.eyebrow` | جولة المنتج | Product tour |
| `site.tour.title` | raclinic كما هو | raclinic as it is |
| `site.tour.lead` | لقطات حقيقية من مساحة العمل، بالبيانات التجريبية — ليست رسومًا تسويقية. اضغط أي لقطة لعرضها بحجمها الكامل. | Real captures of the workspace, with demo data — not marketing drawings. Select any screenshot to see it full size. |
| `site.tour.statShots` | لقطة | screenshots |
| `site.tour.statGroups` | مجالات | areas |
| `site.tour.statLanguages` | لغتان | languages |
| `site.tour.captured` | آخر تحديث للقطات: {{date}} | Screenshots last updated: {{date}} |
| `site.tour.related` | الصفحة المرتبطة | Related page |
| `site.tour.open` | عرض لقطة {{name}} بالحجم الكامل | Open the {{name}} screenshot full size |
| `site.tour.groups.frontDesk.title` | الاستقبال والمواعيد | Front desk and appointments |
| `site.tour.groups.frontDesk.body` | الجدول اليومي وعرض سبعة أيام. | The daily schedule and the 7-day view. |
| `site.tour.groups.patients.title` | المرضى والرئيسية | Patients and home |
| `site.tour.groups.patients.body` | سجل المرضى ولوحة اليوم. | The patient registry and today’s dashboard. |
| `site.tour.groups.clinical.title` | السجل السريري | Clinical records |
| `site.tour.groups.clinical.body` | سجل الزيارة وأدوات كل تخصص. | The visit record and each specialty’s tools. |
| `site.tour.groups.finance.title` | الحسابات | Finance |
| `site.tour.groups.finance.body` | حسابات المرضى والخدمات والأسعار. | Patient accounts, services and prices. |
| `site.tour.shots.appointments.title` | المواعيد اليومية | Daily appointments |
| `site.tour.shots.appointments.body` | مواعيد اليوم لكل الأطباء، بحالاتها وإجراءاتها. | Today’s appointments for all doctors, with statuses and actions. |
| `site.tour.shots.appointments.alt` | لقطة لصفحة المواعيد اليومية | Screenshot of the daily appointments page |
| `site.tour.shots.week.title` | عرض سبعة أيام | 7-day view |
| `site.tour.shots.week.body` | الأسبوع القادم في عرض واحد. | The coming week in one view. |
| `site.tour.shots.week.alt` | لقطة لعرض المواعيد لسبعة أيام | Screenshot of the 7-day appointments view |
| `site.tour.shots.patients.title` | سجل المرضى | Patient registry |
| `site.tour.shots.patients.body` | بحث بالاسم أو رقم الملف أو الهاتف، وفروع التسجيل. | Search by name, file number or phone, with registration branches. |
| `site.tour.shots.patients.alt` | لقطة لسجل المرضى | Screenshot of the patient registry |
| `site.tour.shots.home.title` | الرئيسية | Home |
| `site.tour.shots.home.body` | أعداد مواعيد اليوم حسب الحالة، والتخصصات والفروع. | Today’s appointment counts by status, specialties and branches. |
| `site.tour.shots.home.alt` | لقطة للصفحة الرئيسية لمساحة العمل | Screenshot of the workspace home page |
| `site.tour.shots.record.title` | سجل الزيارة | Visit record |
| `site.tour.shots.record.body` | سجل يكتبه الطبيب المعالج، مسودة ثم اعتماد. | A record written by the treating doctor, draft then finalized. |
| `site.tour.shots.record.alt` | لقطة لسجل زيارة | Screenshot of a visit record |
| `site.tour.shots.dental.title` | مخطط الأسنان | Tooth chart |
| `site.tour.shots.dental.body` | ترقيم FDI ونتائج كل سن وبنود الخطة. | FDI notation, findings per tooth and plan items. |
| `site.tour.shots.dental.alt` | لقطة لمخطط الأسنان | Screenshot of the tooth chart |
| `site.tour.shots.physio.title` | مسار العلاج الطبيعي | Physiotherapy course |
| `site.tour.shots.physio.body` | الأهداف والجلسات الموثقة من المخطط. | Goals and documented sessions out of the planned. |
| `site.tour.shots.physio.alt` | لقطة لمسار علاج طبيعي | Screenshot of a physiotherapy course |
| `site.tour.shots.ent.title` | فحص الأنف والأذن والحنجرة | ENT examination |
| `site.tour.shots.ent.body` | التاريخ والفحص حسب المنطقة. | History and examination by region. |
| `site.tour.shots.ent.alt` | لقطة لفحص الأنف والأذن والحنجرة | Screenshot of the ENT examination |
| `site.tour.shots.finance.title` | الحسابات | Finance |
| `site.tour.shots.finance.body` | البحث عن حساب مريض وملخص الفترة. | Finding a patient account and the period summary. |
| `site.tour.shots.finance.alt` | لقطة لصفحة الحسابات | Screenshot of the finance page |
| `site.tour.shots.services.title` | الخدمات والأسعار | Services and prices |
| `site.tour.shots.services.body` | قائمة الخدمات بأسعارها، ولكل فرع سعره عند الحاجة. | The service list with prices, per branch when needed. |
| `site.tour.shots.services.alt` | لقطة لقائمة الخدمات والأسعار | Screenshot of the services and prices list |
| `site.tour.closingTitle` | جرّبه بنفسك | Try it yourself |
| `site.tour.closingBody` | أنشئ مساحة عمل وجرّب هذه الشاشات ببيانات تجريبية. | Create a workspace and try these screens with demo data. |

## About (`/about`)

| Key | العربية | English |
| --- | --- | --- |
| `site.about.metaTitle` | عن raclinic | About raclinic |
| `site.about.metaDescription` | raclinic مساحة عمل سحابية للعيادات والمراكز الطبية في مصر والسعودية، تطوّرها Devware. | raclinic is a cloud workspace for clinics and medical centers in Egypt and Saudi Arabia, built by Devware. |
| `site.about.eyebrow` | عن raclinic | About raclinic |
| `site.about.title` | مساحة عمل عربية أولًا للعيادات والمراكز الطبية | An Arabic-first workspace for clinics and medical centers |
| `site.about.lead` | raclinic يجمع المواعيد والاستقبال وملفات المرضى وسجلات الزيارة والحسابات في مساحة عمل واحدة، للعيادات والمراكز في مصر والسعودية. | raclinic brings appointments, the front desk, patient files, visit records and finance into one workspace, for clinics and centers in Egypt and Saudi Arabia. |
| `site.about.devwareTitle` | raclinic من Devware | raclinic by Devware |
| `site.about.devwareBody` | تطوّر شركة Devware منصة raclinic وتديرها. هذه الصفحة تصف المنتج كما هو اليوم؛ لا نذكر أعداد عملاء ولا شهادات ولا نتائج لم نقِسها. | Devware builds and runs the raclinic platform. This page describes the product as it is today; we do not state customer numbers, certifications or results we have not measured. |
| `site.about.purposeEyebrow` | لماذا raclinic | Why raclinic |
| `site.about.purposeTitle` | تنظيم يوم العيادة، دون تعقيد | Organizing the clinic day, without complexity |
| `site.about.purposeBody` | هدف raclinic أن يعمل فريق العيادة — الاستقبال والأطباء والمحاسبون والإدارة — في مكان واحد، بلغته، ويرى كلٌّ ما يحتاج إليه فقط. | raclinic’s purpose is for the clinic team — reception, doctors, accountants and management — to work in one place, in their language, each seeing only what they need. |
| `site.about.purposeBody2` | يبدأ بثلاثة تخصصات وبالمراكز متعددة التخصصات، ويبقى ما لا تغطيه مساحة العمل — مثل الأشعة — في مسار مشروعات مخصصة منفصل. | It starts with three specialties and multi-specialty centers; what the workspace does not cover — such as radiology — stays on a separate custom-project path. |
| `site.about.principlesTitle` | مبادئنا | Our principles |
| `site.about.principles.0.title` | العربية أولًا | Arabic first |
| `site.about.principles.0.body` | واجهة عربية كاملة من اليمين إلى اليسار، وإنجليزية كاملة، ويختار كل مستخدم لغته. | A complete right-to-left Arabic interface and complete English; each user picks their language. |
| `site.about.principles.1.title` | بيانات كل منشأة لها وحدها | Each organization’s data is its own |
| `site.about.principles.1.body` | العزل بين المنشآت والفروع يُفرض في الخادم، ولكل دور صلاحياته. | Isolation between organizations and branches is enforced on the server, and every role has its permissions. |
| `site.about.principles.2.title` | الطبيب يكتب | The doctor writes |
| `site.about.principles.2.body` | لا تشخيص ولا اقتراحات علاجية تلقائية؛ السجل يكتبه الطبيب المعالج. | No automatic diagnosis or treatment suggestions; the treating doctor writes the record. |
| `site.about.principles.3.title` | وضوح بشأن المتاح | Clear about what exists |
| `site.about.principles.3.body` | نفصل دائمًا بين ما يعمل اليوم وما هو مخطط له. | We always separate what works today from what is planned. |
| `site.about.offerEyebrow` | ما نقدّمه | What we offer |
| `site.about.offerTitle` | حلول على مساحة عمل واحدة، ومسار مخصص | Solutions on one workspace, and a custom path |
| `site.about.offerLead` | أربعة حلول على مساحة العمل المستضافة، والمشروعات المخصصة منفصلة. | Four solutions on the hosted workspace; custom projects are separate. |
| `site.about.statusEyebrow` | الوضع الحالي | Current status |
| `site.about.statusTitle` | نسخة تطوير | A development version |
| `site.about.statusBody` | raclinic قيد التطوير. هذه أمور لم تتقرر بعد، ولن نعلن عنها قبل أن تتقرر. | raclinic is in development. These are not decided yet, and we will not announce them before they are. |
| `site.about.statusPoints` | • الأسعار وخطط الاشتراك<br>• الاستضافة وموقع تخزين البيانات<br>• مزوّدو الدفع والبريد الإلكتروني<br>• استخدام بيانات مرضى حقيقية | • Prices and subscription plans<br>• Hosting and where data is stored<br>• Payment and email providers<br>• Use of real patient data |
| `site.about.closingTitle` | تريد أن تعرف أكثر؟ | Want to know more? |
| `site.about.closingBody` | جرّب مساحة العمل ببيانات تجريبية، أو تواصل معنا. | Try the workspace with demo data, or contact us. |

## Contact (`/contact`)

| Key | العربية | English |
| --- | --- | --- |
| `site.contact.metaTitle` | تواصل مع raclinic | Contact raclinic |
| `site.contact.metaDescription` | اطلب عرضًا توضيحيًا لمساحة عمل raclinic أو أرسل سؤالًا. | Request a demo of the raclinic workspace or send a question. |
| `site.contact.eyebrow` | تواصل معنا | Get in touch |
| `site.contact.title` | لنتحدث عن عيادتك | Let’s talk about your clinic |
| `site.contact.lead` | اطلب عرضًا توضيحيًا أو أرسل سؤالًا. يُحفظ طلبك برقم مرجعي ويراجعه فريق raclinic. | Request a demo or send a question. Your message is stored with a reference and reviewed by the raclinic team. |
| `site.contact.formLabel` | نموذج التواصل | Contact form |
| `site.contact.infoLabel` | معلومات التواصل | Contact information |
| `site.contact.channels.email` | البريد الإلكتروني | Email |
| `site.contact.channels.phone` | الهاتف | Phone |
| `site.contact.channels.hours` | ساعات الدعم | Support hours |
| `site.contact.noChannelsTitle` | النموذج هو طريقة التواصل الآن | The form is the way to reach us for now |
| `site.contact.noChannelsBody` | لم تُنشر قنوات تواصل أخرى بعد؛ اكتب طريقة للرد عليك في النموذج. | No other contact channels are published yet; leave a way to reply to you in the form. |
| `site.contact.nextTitle` | ماذا يحدث بعد الإرسال | What happens next |
| `site.contact.nextBody` | يظهر لك رقم مرجعي، ويراجع فريق raclinic رسالتك ويرد عليك عبر البيانات التي قدمتها. لا يُرسل بريد تلقائي. | You get a reference; the raclinic team reviews your message and replies using the details you gave. No automatic email is sent. |
| `site.contact.customersTitle` | عميل لدى raclinic؟ | Already a raclinic customer? |
| `site.contact.customersBody` | للدعم، أرسل طلبًا من صفحة «المساعدة والدعم» داخل مساحة العمل، فيصل إلى الفريق مع سياق منشأتك. | For support, send a request from “Help & support” inside your workspace, so it reaches the team with your organization’s context. |
| `site.contact.customersLink` | تسجيل الدخول إلى مساحة العمل | Sign in to your workspace |
| `site.contact.customTitle` | مشروع مخصص أو أشعة؟ | A custom project or radiology? |
| `site.contact.customBody` | لطلبات المشروعات المخصصة نموذج خاص يجمع ما نحتاج إليه لمراجعتها. | Custom-project requests have their own form that collects what we need to review them. |
| `site.contact.steps.contact` | التواصل | Contact |
| `site.contact.steps.message` | الرسالة | Message |
| `site.contact.stepOf` | الخطوة {{step}} من {{total}} | Step {{step}} of {{total}} |
| `site.contact.intentLegend` | بماذا يمكننا مساعدتك؟ | What can we help you with? |
| `site.contact.intents.demo` | عرض توضيحي | A demo |
| `site.contact.intents.question` | سؤال عن raclinic | A question about raclinic |
| `site.contact.intents.other` | أمر آخر | Something else |
| `site.contact.specialty` | التخصص | Specialty |
| `site.contact.message` | رسالتك | Your message |
| `site.contact.messageHint` | من 10 إلى 1500 حرف، دون أي بيانات للمرضى. | 10 to 1500 characters, without any patient information. |
| `site.contact.next` | التالي | Continue |
| `site.contact.back` | السابق | Back |
| `site.contact.submit` | إرسال الرسالة | Send message |
| `site.contact.successTitle` | وصلت رسالتك | Your message has arrived |
| `site.contact.successBody` | حُفظت رسالتك بهذا الرقم المرجعي. احتفظ به إذا تواصلت معنا بشأنها. | Your message is stored with this reference. Keep it if you contact us about it. |
| `site.contact.successNoEmail` | لا يُرسل بريد تلقائي؛ سنرد عليك عبر البيانات التي قدمتها. | No automatic email is sent; we will reply using the details you gave. |
| `site.contact.another` | إرسال رسالة أخرى | Send another message |
| `validation.contact.contactName.empty` | اكتب اسمك. | Enter your name. |
| `validation.contact.contactName.too_short` | اكتب اسمك (حرفان على الأقل). | Enter your name (at least two characters). |
| `validation.contact.contact.contact_required` | اكتب بريدًا إلكترونيًا أو رقم هاتف لنتمكن من الرد عليك. | Enter an email or a phone number so we can reply. |
| `validation.contact.phone.invalid_phone` | رقم الهاتف غير صحيح للدولة المختارة. | This phone number is not valid for the chosen country. |
| `validation.contact.message.empty` | اكتب رسالتك. | Write your message. |
| `validation.contact.message.too_short` | اكتب 10 أحرف على الأقل. | Write at least 10 characters. |

## FAQ (`/faq`)

| Key | العربية | English |
| --- | --- | --- |
| `site.faqPage.metaTitle` | الأسئلة الشائعة | Frequently asked questions |
| `site.faqPage.metaDescription` | إجابات عن raclinic: التخصصات، والبيانات، والحساب، واللغات، والمشروعات المخصصة. | Answers about raclinic: specialties, data, accounts, languages and custom projects. |
| `site.faqPage.eyebrow` | المساعدة | Help |
| `site.faqPage.title` | الأسئلة الشائعة | Frequently asked questions |
| `site.faqPage.lead` | كل ما تحتاج إلى معرفته عن raclinic. لم تجد إجابتك؟ | Everything you need to know about raclinic. Can’t find your answer? |
| `site.faqPage.search` | ابحث في الأسئلة — مثل: الفروع، اللغة، السجل | Search the questions — e.g. branches, language, record |
| `site.faqPage.searchLabel` | ابحث في الأسئلة الشائعة | Search the FAQ |
| `site.faqPage.categoriesLabel` | فئات الأسئلة | Question categories |
| `site.faqPage.all` | الكل | All |
| `site.faqPage.categories.general` | عام | General |
| `site.faqPage.categories.specialties` | التخصصات والسجل | Specialties and records |
| `site.faqPage.categories.data` | البيانات والخصوصية | Data and privacy |
| `site.faqPage.categories.account` | الحساب والاشتراك | Account and subscription |
| `site.faqPage.showing` | عدد الأسئلة المعروضة: {{count}} | Questions shown: {{count}} |
| `site.faqPage.noResults` | لا توجد أسئلة تطابق بحثك. | No questions match your search. |
| `site.faqPage.moreTitle` | ما زال لديك سؤال؟ | Still have a question? |
| `site.faqPage.moreBody` | أرسل سؤالك، ويراجعه فريق raclinic. | Send your question, and the raclinic team will review it. |
| `site.faqPage.items.0.q` | هل يناسب raclinic عيادة بطبيب واحد؟ | Is raclinic suitable for a single-doctor clinic? |
| `site.faqPage.items.0.a` | نعم. يمكنك البدء بفرع واحد وطبيب واحد، وإضافة أطباء وفروع لاحقًا. | Yes. Start with one branch and one doctor, and add doctors and branches later. |
| `site.faqPage.items.0.category` | general | general |
| `site.faqPage.items.1.q` | كيف يُمنع الحجز المزدوج؟ | How are double bookings prevented? |
| `site.faqPage.items.1.a` | تُحسب الأوقات المتاحة من مواعيد عمل الطبيب والحجوزات القائمة، ويُتحقق من الوقت مرة أخرى لحظة تأكيد الحجز داخل عملية واحدة على الخادم. | Free times come from the doctor’s hours and existing bookings, and the time is checked again when the booking is confirmed, in a single server-side operation. |
| `site.faqPage.items.1.category` | general | general |
| `site.faqPage.items.2.q` | من يستطيع قراءة سجل الزيارة؟ | Who can read a visit record? |
| `site.faqPage.items.2.a` | الطبيب المعالج فقط، ومن يشاركه السجل صراحةً من زملائه. يرى المالك والمدير حالة التوثيق دون المحتوى. | Only the treating doctor, and colleagues they explicitly share it with. Owners and admins see whether a visit is documented, not its content. |
| `site.faqPage.items.2.category` | specialties | specialties |
| `site.faqPage.items.3.q` | هل تتوفر الوصفات الطبية والمرفقات؟ | Are prescriptions and attachments available? |
| `site.faqPage.items.3.a` | ليس بعد. الوصفات والمرفقات مخططة، وليست جزءًا من مساحة العمل اليوم. | Not yet. Prescriptions and attachments are planned and are not part of the workspace today. |
| `site.faqPage.items.3.category` | specialties | specialties |
| `site.faqPage.items.4.q` | هل بيانات منشأتي منفصلة عن غيرها؟ | Is my organization’s data separate from others? |
| `site.faqPage.items.4.a` | نعم. كل بيانات المنشأة مرتبطة بها، ويُفرض العزل في الخادم في كل طلب؛ ولا يصل أي عضو إلا إلى فروعه. | Yes. All of an organization’s data belongs to it, isolation is enforced on the server for every request, and members reach only their branches. |
| `site.faqPage.items.4.category` | data | data |
| `site.faqPage.items.5.q` | أين تُخزَّن البيانات؟ | Where is data stored? |
| `site.faqPage.items.5.a` | لم تتقرر الاستضافة وموقع تخزين البيانات بعد؛ هذه نسخة تطوير تستخدم بيانات تجريبية فقط. | Hosting and data location are not decided yet; this is a development version using demo data only. |
| `site.faqPage.items.5.category` | data | data |
| `site.faqPage.items.6.q` | هل يمكن لفريق raclinic رؤية بيانات المرضى؟ | Can the raclinic team see patient data? |
| `site.faqPage.items.6.a` | لوحة تشغيل المنصة تعرض بيانات وصفية عن المنشآت والاشتراكات فقط، ولا تعرض المرضى ولا المواعيد ولا السجلات. | The platform operator console shows only metadata about organizations and subscriptions, never patients, appointments or records. |
| `site.faqPage.items.6.category` | data | data |
| `site.faqPage.items.7.q` | كيف أحصل على الدعم؟ | How do I get support? |
| `site.faqPage.items.7.a` | العملاء يرسلون طلب دعم من صفحة «المساعدة والدعم» داخل مساحة العمل؛ ولغير العملاء صفحة «تواصل معنا». | Customers send a support request from “Help & support” inside the workspace; others can use the contact page. |
| `site.faqPage.items.7.category` | account | account |
| `site.faqPage.items.8.q` | هل يمكنني إضافة أعضاء إلى الفريق؟ | Can I add team members? |
| `site.faqPage.items.8.a` | نعم. يضيف المالك أو المدير الأعضاء ويحدّد دور كل منهم وفروعه، ويمكن إرسال دعوة بالبريد عندما يكون البريد مُعدًّا. | Yes. The owner or an admin adds members with a role and branches, and can send an email invitation when email is configured. |
| `site.faqPage.items.8.category` | account | account |

## Security and privacy (`/security`, `/privacy`)

| Key | العربية | English |
| --- | --- | --- |
| `site.prose.questions` | لديك سؤال عن هذه الصفحة؟ | A question about this page? |
| `site.security.metaTitle` | الأمان وحماية البيانات | Security and data protection |
| `site.security.metaDescription` | كيف تحمي مساحة عمل raclinic البيانات: العزل بين المنشآت، والصلاحيات، والجلسات، وسجلات التدقيق. | How the raclinic workspace protects data: isolation between organizations, permissions, sessions and audit logs. |
| `site.security.title` | الأمان وحماية البيانات | Security and data protection |
| `site.security.lead` | ما تطبقه مساحة العمل اليوم لحماية البيانات، بوضوح ودون ادعاءات. | What the workspace does today to protect data, plainly and without claims. |
| `site.security.sections.0.title` | عزل بين المنشآت والفروع | Isolation between organizations and branches |
| `site.security.sections.0.body` | كل بيانات المنشأة مرتبطة بها، ويتحقق الخادم من المنشأة والفروع المسموح بها في كل طلب. أي معرّف لا يخصك يُرد عليه كأنه غير موجود. | All of an organization’s data belongs to it, and the server checks the organization and allowed branches on every request. Any id that is not yours is answered as if it did not exist. |
| `site.security.sections.1.title` | صلاحيات حسب الدور | Permissions by role |
| `site.security.sections.1.body` | لكل دور من الأدوار الستة صلاحيات محددة يفرضها الخادم؛ إخفاء الأزرار في الواجهة ليس هو الحماية. | Each of the six roles has defined permissions enforced by the server; hiding buttons in the interface is not the protection. |
| `site.security.sections.2.title` | خصوصية السجل السريري | Clinical record privacy |
| `site.security.sections.2.body` | لا يقرأ سجل الزيارة إلا الطبيب المعالج ومن يشاركه معه صراحةً لفترة محددة، وكل وصول مسجَّل. | A visit record is read only by the treating doctor and colleagues they explicitly share it with for a set period, and every access is logged. |
| `site.security.sections.3.title` | الدخول والجلسات | Sign-in and sessions |
| `site.security.sections.3.body` | كلمات المرور تُخزَّن بتجزئة Argon2id، والجلسات في الخادم بملف تعريف آمن، مع حماية من طلبات المواقع الأخرى، وتنتهي الجلسة بعد فترة من عدم النشاط. | Passwords are stored as Argon2id hashes; sessions live on the server behind a secure cookie, with protection against cross-site requests, and end after a period of inactivity. |
| `site.security.sections.4.title` | حدود المحاولات | Rate limits |
| `site.security.sections.4.body` | محاولات تسجيل الدخول واستعادة كلمة المرور والنماذج العامة محدودة، وتُحسب العدادات مشتركة بين خوادم التطبيق. | Sign-in, password recovery and public forms are rate limited, with counters shared between application servers. |
| `site.security.sections.5.title` | سجلات التدقيق | Audit logs |
| `site.security.sections.5.body` | تُسجَّل الإجراءات الإدارية والمالية والسريرية المهمة، وإجراءات مشغّلي المنصة، في سجلات لا تُعدَّل. | Important administrative, financial and clinical actions, and platform operator actions, are recorded in logs that are never edited. |
| `site.security.pendingTitle` | ما لم يتقرر بعد | Not decided yet |
| `site.security.pendingBody` | الاستضافة وموقع تخزين البيانات، والتحقق بخطوتين، ومدد الاحتفاظ بالبيانات لم تتقرر بعد. لا نعلن عن أي شهادات أو امتثال؛ هذه نسخة تطوير ببيانات تجريبية فقط. | Hosting and data location, two-step verification and retention periods are not decided yet. We announce no certifications or compliance; this is a development version with demo data only. |
| `site.privacy.metaTitle` | الخصوصية | Privacy |
| `site.privacy.metaDescription` | ما الذي يجمعه موقع raclinic، ولماذا، ومن يراه. | What the raclinic website collects, why, and who sees it. |
| `site.privacy.title` | كيف يتعامل هذا الموقع مع بياناتك | How this website handles your data |
| `site.privacy.lead` | وصف مبسّط لما يجمعه الموقع اليوم. لم تُعتمد سياسة خصوصية رسمية بعد. | A plain description of what the website collects today. A formal privacy policy has not been adopted yet. |
| `site.privacy.sections.0.title` | نماذج التواصل والمشروعات | Contact and project forms |
| `site.privacy.sections.0.body` | عندما ترسل نموذج «تواصل معنا» أو «اطلب مشروعًا مخصصًا» نحفظ ما تكتبه: اسمك وطريقة التواصل والرسالة، لنرد عليك فقط. لا تكتب فيها بيانات مرضى. | When you send the “Contact us” or “Request a custom project” form, we store what you write: your name, how to reach you and your message, only to reply to you. Do not include patient information. |
| `site.privacy.sections.1.title` | من يرى رسالتك | Who sees your message |
| `site.privacy.sections.1.body` | مشغّلو منصة raclinic المصرح لهم فقط. تظهر بيانات التواصل مخفية جزئيًا، وكشفها الكامل يُسجَّل في سجل المنصة. | Only authorized raclinic platform operators. Contact details are partly masked, and revealing them in full is recorded in the platform audit. |
| `site.privacy.sections.2.title` | ملفات تعريف الارتباط والتخزين | Cookies and storage |
| `site.privacy.sections.2.body` | لا نستخدم أدوات تتبع أو تحليلات أو إعلانات. يُستخدم ملف تعريف للجلسة فقط بعد تسجيل الدخول، وتُحفظ لغتك المختارة في متصفحك. | We use no tracking, analytics or advertising tools. A session cookie is used only after you sign in, and your chosen language is kept in your browser. |
| `site.privacy.sections.3.title` | البريد الإلكتروني | Email |
| `site.privacy.sections.3.body` | لا يُرسل الموقع بريدًا تلقائيًا عند استلام رسالتك؛ نرد عليك يدويًا. | The website sends no automatic email when your message arrives; we reply by hand. |
| `site.privacy.sections.4.title` | الاحتفاظ | Retention |
| `site.privacy.sections.4.body` | مدد الاحتفاظ بالرسائل والطلبات قرار لم يُتخذ بعد؛ حتى يُتخذ تُحفظ السجلات. | How long messages and requests are kept is not decided yet; until it is, records are kept. |
| `site.privacy.pendingTitle` | سياسة رسمية قبل الإطلاق التجاري | A formal policy before commercial launch |
| `site.privacy.pendingBody` | ستُنشر سياسة خصوصية رسمية قبل إتاحة raclinic تجاريًا أو استخدام بيانات مرضى حقيقية. | A formal privacy policy will be published before raclinic is commercially available or real patient data is used. |

## Workspace creation entry and not-found page

| Key | العربية | English |
| --- | --- | --- |
| `site.start.title` | أنشئ مساحة عمل لعيادتك | Create your clinic workspace |
| `site.start.loading` | جارٍ تجهيز إعداد مساحة العمل… | Preparing your workspace setup… |
| `site.notFound.title` | الصفحة غير موجودة | Page not found |
| `site.notFound.body` | هذه الصفحة غير موجودة. تصفّح الحلول المتاحة بدلًا منها. | This page does not exist. Browse the available solutions instead. |
| `site.notFound.solutions` | عرض الحلول | View solutions |

## Sign in and registration

| Key | العربية | English |
| --- | --- | --- |
| `auth.systemStatus` | حالة النظام | System status |
| `auth.loginTitle` | تسجيل الدخول | Sign in |
| `auth.loginSubtitle` | ادخل إلى مساحة عمل منشأتك. | Open your organization's workspace. |
| `auth.email` | البريد الإلكتروني | Email |
| `auth.password` | كلمة المرور | Password |
| `auth.submitLogin` | دخول | Sign in |
| `auth.submittingLogin` | جارٍ الدخول… | Signing in… |
| `auth.noAccount` | ليس لديك حساب؟ | Don't have an account? |
| `auth.registerLink` | إنشاء حساب | Create an account |
| `auth.registerTitle` | إنشاء حساب | Create an account |
| `auth.registerSubtitle` | أنشئ حسابك ثم أضف منشأتك الأولى. | Create your account, then add your first organization. |
| `auth.displayName` | الاسم الظاهر | Display name |
| `auth.passwordHint` | 10 أحرف على الأقل. | At least 10 characters. |
| `auth.verificationNote` | التحقق من البريد الإلكتروني واستعادة كلمة المرور غير متاحين بعد في هذه المرحلة. | Email verification and password recovery are not available yet in this phase. |
| `auth.submitRegister` | إنشاء الحساب | Create account |
| `auth.submittingRegister` | جارٍ إنشاء الحساب… | Creating account… |
| `auth.haveAccount` | لديك حساب بالفعل؟ | Already have an account? |
| `auth.loginLink` | تسجيل الدخول | Sign in |

## Organization setup (onboarding)

| Key | العربية | English |
| --- | --- | --- |
| `onboarding.title` | إعداد المنشأة | Set up your organization |
| `onboarding.subtitle` | أهلًا {{name}}. خطوات قليلة وتصبح مساحة العمل جاهزة، وتكون ملكيتها لحسابك. | Welcome {{name}}. A few steps and your workspace is ready; your account will own it. |
| `onboarding.orgName` | اسم المنشأة | Organization name |
| `onboarding.branchName` | اسم الفرع الأول | First branch name |
| `onboarding.branchHint` | يمكنك إضافة فروع أخرى لاحقًا. | You can add more branches later. |
| `onboarding.city` | المدينة | City |
| `onboarding.submit` | إنشاء مساحة العمل | Create workspace |
| `onboarding.submitting` | جارٍ الإنشاء… | Creating… |
| `onboarding.backToWorkspace` | العودة إلى مساحة العمل | Back to workspace |
| `onboarding.progress` | خطوات الإعداد | Setup steps |
| `onboarding.stepLabel` | الخطوة {{current}} من {{total}} | Step {{current}} of {{total}} |
| `onboarding.steps.organization` | المنشأة | Organization |
| `onboarding.steps.specialties` | التخصصات | Specialties |
| `onboarding.steps.branch` | الفرع الأول | First branch |
| `onboarding.steps.review` | المراجعة | Review |
| `onboarding.resumed` | أنت تكمل إعدادًا بدأته من قبل. | You are continuing a setup you started earlier. |
| `onboarding.saved` | تم حفظ ما أدخلته. يمكنك المغادرة والمتابعة لاحقًا. | Progress saved. You can leave and continue later. |
| `onboarding.conflict` | تغيّر هذا الإعداد في نافذة أخرى، ويظهر الآن آخر ما تم حفظه. | This setup was changed in another tab. The latest saved version is shown. |
| `onboarding.type` | نوع المنشأة | Type of organization |
| `onboarding.types.clinic.title` | عيادة فردية | Individual clinic |
| `onboarding.types.clinic.body` | عيادة واحدة بها طبيب أو أكثر. | One clinic, with one or more doctors. |
| `onboarding.types.medical_center.title` | مركز طبي | Medical center |
| `onboarding.types.medical_center.body` | عدة تخصصات ضمن منشأة واحدة. | Several specialties under one organization. |
| `onboarding.types.multi_branch.title` | منشأة متعددة الفروع | Organization with several branches |
| `onboarding.types.multi_branch.body` | منشأة واحدة تدير أكثر من موقع. | One organization running more than one location. |
| `onboarding.timeZone` | المنطقة الزمنية | Time zone |
| `onboarding.timeZoneHint` | تُستخدم هذه المنطقة الزمنية للمواعيد ومواعيد العمل، ولا تُؤخذ من لغتك أو من المتصفح. | Appointments and working hours use this time zone. It is not taken from your language or browser. |
| `onboarding.chooseTimeZone` | — اختر المنطقة الزمنية — | — Choose a time zone — |
| `onboarding.specialtiesTitle` | ما التخصصات التي تقدمها منشأتك؟ | Which specialties does your organization practice? |
| `onboarding.specialtiesHint` | اختر كل ما ينطبق، ويمكنك تعديلها لاحقًا من الإعدادات. | Choose all that apply. You can change them later in settings. |
| `onboarding.preselected` | تم اختياره مسبقًا من الحل الذي اخترته: {{name}}. | Pre-selected from the solution you chose: {{name}}. |
| `onboarding.otherSpecialtiesNote` | التخصصات الأخرى، مثل الأشعة، غير متاحة في مساحة العمل المستضافة، ويمكن طلبها كمشروع مخصص. | Other specialties, such as radiology, are not available in the hosted workspace; they can be requested as a custom project. |
| `onboarding.branchSpecialties` | التخصصات المقدَّمة في هذا الفرع | Specialties offered at this branch |
| `onboarding.branchSpecialtiesHint` | من بين التخصصات التي اخترتها للمنشأة فقط. | Only the specialties chosen for the organization. |
| `onboarding.moreBranchesHint` | بعد الإعداد، يمكن للمالكين والمديرين إضافة باقي الفروع من صفحة «الفروع» في مساحة العمل واختيار تخصصاتها. | After setup, owners and admins can add the other branches from Branches in the workspace and choose their specialties. |
| `onboarding.reviewTitle` | راجِع قبل الإنشاء | Check before creating |
| `onboarding.reviewOwner` | ستكون مالك هذه المنشأة. | You will be the owner of this organization. |
| `onboarding.reviewTerms` | لا حاجة إلى بيانات دفع. لم تُعلن الخطط التجارية بعد. | No payment details are needed. Commercial plans have not been announced yet. |
| `onboarding.edit` | تعديل | Edit |
| `onboarding.back` | السابق | Back |
| `onboarding.next` | التالي | Next |
| `onboarding.saving` | جارٍ الحفظ… | Saving… |
| `onboarding.existingTitle` | لديك مساحة عمل بالفعل | You already have a workspace |
| `onboarding.existingBody` | افتح إحدى منشآتك، أو أعدّ منشأة جديدة. المنشأة الجديدة منفصلة عن المنشآت التي تنتمي إليها. | Open one of your organizations, or set up a new one. A new organization is separate from the ones you already belong to. |
| `onboarding.openWorkspace` | فتح {{name}} | Open {{name}} |
| `onboarding.createAnother` | إعداد منشأة جديدة | Set up a new organization |
