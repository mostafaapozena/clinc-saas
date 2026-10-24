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
| `site.nav.createWorkspace` | أنشئ مساحة عمل لعيادتك | Create your clinic workspace |
| `site.nav.goToWorkspace` | الانتقال إلى مساحة العمل | Go to my workspace |
| `site.nav.openMenu` | فتح القائمة | Open menu |
| `site.nav.closeMenu` | إغلاق القائمة | Close menu |
| `site.cta.create` | أنشئ مساحة عمل لعيادتك | Create your clinic workspace |
| `site.cta.custom` | اطلب مشروعًا مخصصًا | Request a custom project |
| `site.notice` | raclinic قيد التطوير: استخدم بيانات تجريبية فقط. لم تُعلن الأسعار وشروط الاشتراك بعد. | raclinic is in development: use test data only. Prices and subscription terms have not been announced yet. |
| `site.footer.about` | raclinic — مساحة عمل سحابية للعيادات والمراكز الطبية في مصر والسعودية. | raclinic — a cloud workspace for clinics and medical centers in Egypt and Saudi Arabia. |
| `site.footer.devNotice` | نسخة تطوير: استخدم بيانات تجريبية فقط ولا تُدخل بيانات مرضى حقيقية. | Development version: use test data only and do not enter real patient information. |
| `site.footer.status` | حالة النظام | System status |

## Home page (`/`)

| Key | العربية | English |
| --- | --- | --- |
| `site.home.metaTitle` | إدارة المواعيد والاستقبال وملفات المرضى | Appointments, front desk and patient records for clinics |
| `site.home.metaDescription` | raclinic مساحة عمل سحابية بالعربية والإنجليزية للعيادات والمراكز الطبية في مصر والسعودية: سجل المرضى، وجداول الأطباء، والحجز دون تعارض، وتسجيل الوصول، وقائمة الانتظار. | raclinic is a bilingual cloud workspace for clinics and medical centers in Egypt and Saudi Arabia: patient registry, doctors' schedules, conflict-free booking, check-in and the daily queue. |
| `site.home.eyebrow` | مساعدك الذكي في كل تفاصيل العيادة | Smart clinic management |
| `site.home.title` | عيادتك منظَّمة من أول حجز حتى آخر زيارة | Your clinic, organized from the first booking to the last visit |
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
| `site.home.pathsTitle` | الحلول | Solutions |
| `site.home.pathsLead` | ابدأ من الحل الأقرب لعيادتك؛ جميع الحلول تعمل اليوم على مساحة العمل التشغيلية نفسها. | Start from the solution closest to your clinic; all of them run on the same operational workspace today. |
| `site.home.availableTitle` | المتاح اليوم | Available today |
| `site.home.availableLead` | هذه الخصائص تعمل الآن في مساحة العمل المشتركة: | These features work now in the shared workspace: |
| `site.home.plannedTitle` | غير متاح بعد | Not available yet |
| `site.home.plannedBody` | السجلات الطبية، وأدوات التخصصات مثل مخطط الأسنان وخطط العلاج الطبيعي وسجلات فحص الأنف والأذن والحنجرة، والفواتير والتذكيرات والحجز الإلكتروني للمرضى — كلها مخططة لمراحل قادمة، وليست جزءًا من مساحة العمل اليوم. | Clinical records, specialty tools such as dental charts, physiotherapy treatment plans and ENT examination records, billing, reminders and online booking for patients are planned for later stages. They are not part of the workspace today. |
| `site.home.stepsTitle` | كيف تبدأ | How to get started |
| `site.home.steps.account.title` | أنشئ حسابك | Create your account |
| `site.home.steps.account.body` | اسمك وبريدك الإلكتروني وكلمة مرور. | Your name, email address and a password. |
| `site.home.steps.organization.title` | عرّف منشأتك | Describe your organization |
| `site.home.steps.organization.body` | عيادة أو مركز طبي أو منشأة متعددة الفروع، واسمها ومنطقتها الزمنية. | A clinic, a medical center or several branches — its name and time zone. |
| `site.home.steps.specialties.title` | اختر التخصصات والفرع الأول | Choose specialties and the first branch |
| `site.home.steps.specialties.body` | التخصصات التي تقدمها، وما يقدمه الفرع الأول منها. | The specialties you offer, and which of them the first branch provides. |
| `site.home.steps.workspace.title` | راجِع وابدأ | Review and start |
| `site.home.steps.workspace.body` | تأكّد من البيانات، وأنشئ مساحة العمل، ثم أضف فريقك والأطباء وباقي الفروع. | Check the details, create the workspace, then add your team, doctors and further branches. |
| `site.home.faqTitle` | أسئلة شائعة | Frequently asked questions |
| `site.home.faq.price.q` | كم التكلفة؟ | How much does it cost? |
| `site.home.faq.price.a` | لم تُعلن الأسعار وخطط الاشتراك بعد، وستُنشر قبل إتاحة raclinic تجاريًا. | Prices and subscription plans have not been announced yet. They will be published before raclinic is offered commercially. |
| `site.home.faq.clinical.q` | هل يمكنني حفظ الملاحظات والسجلات الطبية؟ | Can I keep clinical notes and medical records? |
| `site.home.faq.clinical.a` | ليس بعد. مساحة العمل الحالية إدارية: بيانات تواصل المرضى، والجداول، والمواعيد، وقائمة الانتظار اليومية. السجلات الطبية مخططة لمرحلة لاحقة. | Not yet. The current workspace covers administration: patient contact details, schedules, appointments and the daily queue. Clinical records are planned for a later stage. |
| `site.home.faq.specialties.q` | هل توجد أدوات خاصة بطب الأسنان أو العلاج الطبيعي أو الأنف والأذن والحنجرة؟ | Are there tools specific to dentistry, physiotherapy or ENT? |
| `site.home.faq.specialties.a` | ليس بعد. تستخدم هذه التخصصات اليوم مساحة العمل التشغيلية المشتركة، وستُصمَّم أدوات كل تخصص بالتعاون مع أطباء ممارسين وتضاف لاحقًا. | Not yet. These specialties use the shared operational workspace today. Specialty tools will be designed with practising clinicians and added later. |
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
| `site.shared` | • سجل مرضى مع البحث بالاسم أو رقم الهاتف أو رقم الملف<br>• مواعيد العمل الأسبوعية لكل طبيب، والتعديلات في أيام محددة<br>• حجز المواعيد وتغييرها وإلغاؤها دون تعارض<br>• تسجيل وصول المريض وقائمة الانتظار اليومية<br>• أعداد مواعيد اليوم حسب الحالة<br>• عدة فروع، وصلاحيات حسب الدور والفرع<br>• واجهة كاملة بالعربية والإنجليزية | • Patient registry with search by name, phone number or patient number<br>• Each doctor's weekly working hours and date-specific changes<br>• Booking, rescheduling and cancellation without double booking<br>• Check-in on arrival and the daily waiting queue<br>• Today's appointment counts by status<br>• Several branches, with access by role and branch<br>• Full Arabic and English interface |

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

## Solutions catalog (`/solutions`) and shared solution labels

| Key | العربية | English |
| --- | --- | --- |
| `site.solutions.metaTitle` | حلول للعيادات والمراكز الطبية | Solutions for clinics and medical centers |
| `site.solutions.metaDescription` | حلول raclinic لعيادات الأسنان ومراكز العلاج الطبيعي وعيادات الأنف والأذن والحنجرة والمراكز الطبية متعددة التخصصات، على مساحة عمل تشغيلية مشتركة. | raclinic solutions for dental clinics, physiotherapy centers, ENT clinics and multi-specialty medical centers, on a shared operational workspace. |
| `site.solutions.title` | الحلول | Solutions |
| `site.solutions.lead` | كل الحلول تبدأ من مساحة العمل التشغيلية نفسها. أدوات التخصصات الطبية مخططة، وستضاف بعد مراجعتها مع أطباء ممارسين. | Every solution starts from the same operational workspace. Specialty clinical tools are planned and will be added after review with practising clinicians. |
| `site.solutions.labels.audience` | لمن هذا الحل | Who it is for |
| `site.solutions.labels.needs` | احتياجات يومية يغطيها اليوم | Everyday needs it covers today |
| `site.solutions.labels.available` | المتاح اليوم في مساحة العمل المشتركة | Available today in the shared workspace |
| `site.solutions.labels.planned` | أدوات التخصص المخططة | Specialty tools being planned |
| `site.solutions.labels.plannedNote` | غير متاحة بعد. تحتاج هذه الأدوات إلى مراجعة مع أطباء ممارسين، ولا يوجد موعد محدد لإتاحتها. | Not available yet. These tools need review with practising clinicians and have no release date. |
| `site.solutions.labels.back` | كل الحلول | All solutions |
| `site.solutions.labels.sharedBadge` | مساحة العمل المشتركة | Shared workspace |
| `site.solutions.customCard.title` | تحتاج إلى شيء مختلف؟ | Need something different? |
| `site.solutions.customCard.body` | التخصصات المعقدة مثل الأشعة، أو نظام تديره منشأتك بنفسها، تُنفَّذ كمشروعات مخصصة يُحدَّد نطاقها بشكل منفصل. | Complex specialties such as radiology, or a system you run yourselves, are handled as separately scoped custom projects. |
| `site.solutions.customCard.badge` | مشروع مخصص | Custom project |

## Dental clinics (`/solutions/dentistry`)

| Key | العربية | English |
| --- | --- | --- |
| `site.solutions.dentistry.name` | عيادات الأسنان | Dental clinics |
| `site.solutions.dentistry.summary` | نظّم مواعيد كل طبيب أسنان، ووصول المرضى، وبيانات التواصل في عيادات ومراكز الأسنان. | Organize each dentist's appointments, patient arrivals and contact details for dental clinics and centers. |
| `site.solutions.dentistry.metaDescription` | مواعيد لكل طبيب أسنان، وتسجيل الوصول، وقائمة الانتظار، وملفات المرضى لعيادات الأسنان في مصر والسعودية. | Appointments by dentist, check-in, the daily queue and patient records for dental clinics in Egypt and Saudi Arabia. |
| `site.solutions.dentistry.audience` | عيادات الأسنان التي يعمل بها طبيب أو أكثر، وأقسام الأسنان في المراكز الطبية. | Dental clinics with one or more dentists, and dental departments of medical centers. |
| `site.solutions.dentistry.needs` | • مواعيد بمدد مختلفة لكل طبيب أسنان<br>• حجز زيارات المتابعة دون تعارض<br>• تسجيل وصول المرضى ودخولهم حسب ترتيب الوصول | • Appointments of different lengths for each dentist<br>• Follow-up visits booked without clashes<br>• Patients checked in and seen in order of arrival |
| `site.solutions.dentistry.planned` | • مخطط الأسنان<br>• خطط علاج على عدة جلسات | • Dental chart<br>• Treatment plans over several sessions |

## Physiotherapy centers (`/solutions/physiotherapy`)

| Key | العربية | English |
| --- | --- | --- |
| `site.solutions.physiotherapy.name` | مراكز العلاج الطبيعي | Physiotherapy centers |
| `site.solutions.physiotherapy.summary` | رتّب الجلسات المتكررة لكل أخصائي، وفي أكثر من فرع، بجدول يومي واضح. | Plan recurring sessions per therapist, across branches, with a clear daily schedule. |
| `site.solutions.physiotherapy.metaDescription` | حجز الجلسات لكل أخصائي، وعدة فروع، وتسجيل الوصول، وقائمة الانتظار لمراكز العلاج الطبيعي. | Session booking per therapist, several branches, check-in and the daily queue for physiotherapy centers. |
| `site.solutions.physiotherapy.audience` | مراكز العلاج الطبيعي وأقسام التأهيل التي يعمل بها أخصائي أو أكثر. | Physiotherapy centers and rehabilitation departments with one or more therapists. |
| `site.solutions.physiotherapy.needs` | • جلسات متكررة مع الأخصائي نفسه<br>• أخصائيون يعملون في أكثر من فرع<br>• جدول واضح لكل أخصائي ولكل يوم | • Repeated sessions with the same therapist<br>• Therapists working at more than one branch<br>• A clear schedule for each therapist and day |
| `site.solutions.physiotherapy.planned` | • خطط علاج مع متابعة الجلسات<br>• سجلات التقدم | • Treatment plans with session tracking<br>• Progress records |

## ENT clinics (`/solutions/ent`)

| Key | العربية | English |
| --- | --- | --- |
| `site.solutions.ent.name` | عيادات الأنف والأذن والحنجرة | ENT clinics |
| `site.solutions.ent.summary` | كشوفات قصيرة، وغرفة انتظار مزدحمة، وزيارات متابعة — منظمة في مكان واحد. | Short consultations, busy waiting rooms and follow-up visits, organized in one place. |
| `site.solutions.ent.metaDescription` | المواعيد وتسجيل الوصول وقائمة الانتظار وملفات المرضى لعيادات الأنف والأذن والحنجرة. | Appointments, check-in, the waiting queue and patient records for ear, nose and throat clinics. |
| `site.solutions.ent.audience` | عيادات الأنف والأذن والحنجرة وأقسامها في المراكز الطبية. | Ear, nose and throat clinics and ENT departments of medical centers. |
| `site.solutions.ent.needs` | • مواعيد كشف قصيرة<br>• غرفة انتظار مزدحمة تُدار حسب ترتيب الوصول<br>• مرضى يعودون للمتابعة | • Short consultation slots<br>• A busy waiting room handled in order of arrival<br>• Patients returning for follow-up |
| `site.solutions.ent.planned` | • سجلات فحص منظمة | • Structured examination records |

## Multi-specialty medical centers (`/solutions/medical-centers`)

| Key | العربية | English |
| --- | --- | --- |
| `site.solutions.medicalCenters.name` | المراكز الطبية متعددة التخصصات | Multi-specialty medical centers |
| `site.solutions.medicalCenters.summary` | أدِر عدة تخصصات وفروع في منشأة واحدة، ويقدم كل فرع التخصصات التي تختارها. | Run several specialties and branches in one organization; each branch offers the specialties you choose. |
| `site.solutions.medicalCenters.metaDescription` | مساحة عمل واحدة للمراكز الطبية متعددة التخصصات: تخصصات لكل فرع، وملف مريض مشترك، وصلاحيات حسب الدور. | One workspace for multi-specialty medical centers: specialties per branch, shared patient records and role-based access. |
| `site.solutions.medicalCenters.audience` | المراكز والمجموعات الطبية التي تقدم عدة تخصصات، في موقع واحد أو عدة فروع. | Medical centers and groups that offer several specialties, at one location or several branches. |
| `site.solutions.medicalCenters.needs` | • تخصصات مختلفة في فروع مختلفة<br>• ملف واحد للمريض في كل الفروع<br>• وصول كل عضو في الفريق إلى فروعه فقط | • Different specialties at different branches<br>• One patient record across the branches<br>• Each team member limited to their own branches |
| `site.solutions.medicalCenters.planned` | • أدوات التخصصات السابقة عند إتاحة كل منها | • The specialty tools above, as each becomes available |

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
| `site.inquiry.descriptionHint` | من ١٠ إلى ١٥٠٠ حرف، دون أي بيانات للمرضى. | 10 to 1,500 characters. No patient information. |
| `site.inquiry.submit` | إرسال الطلب | Send request |
| `site.inquiry.submitting` | جارٍ الإرسال… | Sending… |
| `site.inquiry.successTitle` | تم استلام الطلب | Request received |
| `site.inquiry.successBody` | حُفظ طلبك بالرقم المرجعي {{reference}}. احتفظ به إذا تواصلت معنا بشأن الطلب. | Your request was saved with reference {{reference}}. Keep this reference if you contact us about it. |
| `site.inquiry.another` | إرسال طلب آخر | Send another request |
| `site.inquiry.backHome` | العودة إلى الصفحة الرئيسية | Back to the home page |

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
| `onboarding.subtitle` | أهلًا {{name}}. خطوات قليلة وتصبح مساحة العمل جاهزة، وستكون أنت مالكها. | Welcome {{name}}. A few steps and your workspace is ready. You will be its owner. |
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
