/**
 * The guide the teachers' help chat answers from (DECISIONS.md BN), topic by topic. It is all the assistant knows about
 * 익히미, so when a feature changes, change its topic here in the same commit, as with the legal texts.
 *
 * Written in English for the model. On-screen names come from the message catalogs through `L(key)`, so the assistant
 * quotes the exact label in the teacher's language, and a renamed button can never leave the guide behind. Numbers come
 * from CONFIG and the prices in force. Topics marked `sells` are left out in the store apps, where nothing is sold.
 */
import { CONFIG } from '@ikhimi/db'
import type { Pricing } from '@ikhimi/ai'
import { formatKrw, getTranslator, type Locale, type MessageKey } from '@ikhimi/i18n'

/** `L`: an on-screen name in «», `t`: the plain message */
type Ctx = { L: (key: MessageKey) => string; t: (key: MessageKey) => string; prices: Pricing }
type Topic = { id: string; sells?: boolean; text: (c: Ctx) => string }

const won = (n: number) => formatKrw(n, '원')

const TOPICS: Topic[] = [
  {
    id: 'start',
    text: ({ L }) => `Getting started. Teachers use every feature for free.
1. On ${L('nav.home')} write in the chat box what you taught and what homework you need, or attach the textbook pages, and send it. The AI shows a plan; press ${L('plan.create')}.
2. Check the draft and press ${L('action.publish')}: choose a group (or make a new one) and a deadline.
3. Send the link or QR code to your students, or give them the group code. Results appear on the group page and in ${L('nav.reports')} as students hand in.
Two ways to make homework: ${L('compose.mode.create')} (the AI writes new exercises) and ${L('compose.mode.digitize')} (the book's own exercises are copied as they are).`,
  },
  {
    id: 'create',
    text: ({ L }) => `Making new homework (${L('compose.mode.create')}, the default mode on ${L('nav.home')}).
- Write in the box (it says ${L('compose.placeholder')}): the topic, the level, and anything you want exactly, e.g. "10 gap-fill sentences and 5 matching". The teacher's request always comes first: the AI makes exactly the counts and kinds you name and decides only what you leave open. The microphone button ${L('compose.voice')} lets you dictate.
- ${L('compose.attach')} (the paperclip button): ${L('attach.camera')}, ${L('attach.gallery')}, ${L('attach.file')} (PDF or Word .docx) or ${L('attach.audio')}. Up to ${CONFIG.maxMaterialPages} pages per homework. For a longer PDF, write which pages in ${L('compose.pdfPages')} (e.g. 12-14): these are the page numbers of the PDF file, not the numbers printed in the book. An old Word .doc file must be saved as .docx or PDF first.
- The chips under the box: minutes (${L('param.duration')}), ${L('param.difficulty')}, ${L('compose.language')} (the language being taught; guessed from your words, you can change it), ${L('compose.style')} (${L('compose.styleStandard')} or an exam style, see topic exam), ${L('compose.course')} (if the homework is for one of your online courses: your choices are remembered per course) and ${L('compose.more')} (skills to focus on).
- After you send, the AI shows the plan (${L('plan.label')}): its parts with exercise kinds and counts and the minutes. Change it with ${L('plan.less')} / ${L('plan.more')}, ${L('plan.removePart')}, ${L('plan.addPart')}, the ${L('plan.vocab')} switch (short vocabulary items mixed in among the exercises, on by default), or write the change in the box. Nothing is written until you press ${L('plan.create')}; writing takes about 1-3 minutes. You may leave the page: with ${L('settings.generationChime')} on (Profile settings) a sound tells you it's ready.
- Pictures your pages need are cut out of your own photos and PDFs automatically. The AI never draws new pictures.
- 익히미 works best for language lessons and fact-based subjects; homework for subjects with calculations needs extra checking.`,
  },
  {
    id: 'digitize',
    text: ({ L }) => `Copying the book's exercises (${L('compose.mode.digitize')}, the second mode on ${L('nav.home')}).
- Photograph up to ${CONFIG.maxMaterialPages} pages of the book, workbook or test, or add a PDF (a long PDF needs its pages in ${L('compose.pdfPages')}, e.g. 12-14, the PDF's page numbers). In the box you may say which exercises, e.g. "only 4a, 4b and 5"; otherwise all of them.
- The exercises are copied word for word with their numbers and order, and their pictures. Nothing is changed, shortened or invented.
- Exercises that can't be checked automatically (essays, speaking, drawing, pair work) are not copied: the draft lists them under ${L('draft.skipped.title')}; give them in the notebook.
- For the right answers see topic answers; for listening exercises see topic audio.`,
  },
  {
    id: 'answers',
    text: ({ L }) => `The book's answers when copying exercises.
- In ${L('compose.mode.digitize')}, ${L('digitize.answers.upload')} (under ${L('digitize.answers.title')}) takes the answer pages: photos, a PDF or Word, at most ${CONFIG.maxAnswerPages} pages, only the pages with these exercises' answers, not the whole book. For a longer PDF write its pages in ${L('digitize.answers.pdfPages')} (e.g. 142-143). Then the answers are the book's own; they are matched by unit and exercise number.
- Without answer pages the AI solves the exercises itself and can be wrong: each such answer is marked ${L('draft.flag.answer_ai_inferred')}. Check them before publishing.
- On the draft, the ${L('answers.title')} panel shows how many answers came from the book and how many the AI found, and still takes answer pages after copying (${L('answers.read')}): it replaces the AI's answers with the book's and lists where they differed.
- Answer files are deleted once read; only the answers are kept.`,
  },
  {
    id: 'audio',
    text: ({ L }) => `Listening exercises need the real recording.
- A copied listening exercise is marked ${L('draft.flag.needs_audio')}. The homework can't be published until every listening exercise has its audio.
- On the draft press ${L('audio.upload')}. If the file name has the track number (e.g. "Track 1.12.mp3"), it attaches itself; otherwise choose which exercise it is for. You can pick several files, a whole folder (${L('audio.folder')}, on a computer) or the book's ZIP file at once: only the tracks needed are uploaded. Each listening exercise without audio also has its own ${L('audio.upload')} button.
- The AI listens and takes the answers from the recording. If it says the file doesn't fit the exercise and you are sure it does, press ${L('audio.attachAnyway')} and check the answers yourself.
- In ${L('compose.mode.create')}, attach a recording with ${L('compose.attach')} → ${L('attach.audio')} and the AI makes listening exercises about it.`,
  },
  {
    id: 'draft',
    text: ({ L }) => `Checking and changing the draft (the page that opens after the homework is written).
- Every exercise shows its correct answers, the points and the minutes. Name the homework in ${L('draft.titleLabel')}.
- Orange marks point at what to check, e.g. ${L('draft.flag.solve_back_disagrees')}, ${L('draft.flag.answer_ai_inferred')}, ${L('draft.flag.review_flagged')}.
- On each exercise: ${L('action.edit')} (text, options, the right answers; accepted answers separated by commas), ${L('action.regenerate')} (a new version of only that exercise) and ${L('action.delete')}.
- The box at the bottom (${L('draft.refinePlaceholder')}) changes the whole draft from your words, e.g. "make it harder" or "add 3 more gap fills".
- ${L('profile.showAnswers')}: ${L('profile.showAnswers.submit')} (after checking each question the student sees the right answer and the explanation) or ${L('profile.showAnswers.never')} (only right or wrong). Your default for new homework is in Profile → ${L('profile.defaults')}, with ${L('profile.strictness')} and ${L('profile.typo')}.
- When it's ready press ${L('action.publish')} (topic publish). Unpublished homework stays in ${L('nav.reports')} under ${L('reports.drafts')}.`,
  },
  {
    id: 'publish',
    text: ({ L }) => `Publishing and sending homework to students.
- On the draft press ${L('action.publish')}. ${L('publish.chooseGroup')}: ${L('publish.existingGroup')} or ${L('publish.createGroup')} (a name like 9-B; level, start date, number of students and a note are optional and only for you, the AI never uses them). Every homework belongs to a group; groups are made this way.
- ${L('publish.due')}: how long students have (topic deadline).
- Then ${L('share.title')}: the link with ${L('action.copyLink')}, ${L('share.qrLink')} and ${L('share.telegram')}. A student who opens the link once joins the group and later sees the group's homework without links. Students can also join with the group code (topic students).
- Students whose Telegram is linked get a message about new homework, and the evening before the deadline a reminder if they haven't handed it in.
- Opening your own homework link shows it as students see it (a preview; you are not counted as a student).`,
  },
  {
    id: 'deadline',
    text: ({ L, t }) => `Deadlines are a duration, not a date.
- When publishing choose ${L('due.oneDay')}, «${t('due.days').replace('{n}', '2')}», ${L('due.oneWeek')}, ${L('due.month')} or ${L('due.other')} (any number of days up to 180), or none.
- Every student gets the whole duration from the day the homework reached them: the day it was published, or the day they joined the group if later. It ends at 23:59 Korean time on the last day. So a new student is never late for older homework, and homework given again needs no new date.
- Change or remove it later on the homework's page or its results page (${L('due.change')} / ${L('due.set')}); results follow.`,
  },
  {
    id: 'students',
    text: ({ L }) => `How students join and do homework.
- They open the homework link or QR code, or type the group code: it is on the group page (${L('groups.joinCode')}, 6 letters and digits); the student opens ${L('nav.myWork')} → ${L('joinGroup.open')} and types it. Either way they are in your group and see all of its homework.
- Students sign in with Telegram in one tap (or phone and password); a new account chooses ${L('auth.roleStudent')}. They need nothing else: homework works in the phone's browser, and 익히미 also has phone apps.
- Answers are checked at once and saved even without internet. Wrong answers come back later in ${L('review.title')} so they are learned.
- Only students in your groups appear in your results; a student sees their own results and the class average, never classmates' scores (unless you turn on the group ranking, topic groups).`,
  },
  {
    id: 'results',
    text: ({ L, t }) => `Results of a homework (open it from the group page or ${L('nav.reports')}).
- ${L('report.average')}, ${L('report.submissionRate')}, ${L('report.medianTime')}, every student's score, ${L('report.hardest')} and ${L('report.commonWrong')}.
- A typed answer marked wrong that is actually right: press the button under it that reads ${t('report.acceptAnswer').replace('{answer}', '…')} (with that answer in place of …). It becomes accepted, every student who wrote it is re-scored, and later students get it right.
- ${L('remind.button')}: a reminder to everyone in the group who hasn't handed in yet and has Telegram linked (once a day per student; it says how many have no Telegram).
- Written work and essays: topic writing. ${L('report.studentPage')} opens a student's progress (topic student).
- Each student's plan decides which exercises they see; exercises outside it show as not shown to that student.`,
  },
  {
    id: 'writing',
    text: ({ L }) => `Exercises students write themselves.
- ${L('draft.kind.open_writing')}: students write their own sentences; the AI checks each sentence, corrects it and explains in one line.
- ${L('draft.kind.essay')}: one longer text graded on the exam's criteria. On the draft choose ${L('draft.essayGraderAi')} or ${L('draft.essayGraderTeacher')}.
- In the results: ${L('report.gradedByAi')}; ${L('report.adjust')} lets you change any grade and add a note; ${L('report.regrade')} if the AI couldn't grade. Work waiting for you shows ${L('report.yourTurn')}.
- The AI never guesses: if it can't grade, the work waits for you.`,
  },
  {
    id: 'groups',
    text: ({ L }) => `Groups (${L('nav.groups')}).
- A group is made when you publish homework into it (${L('publish.createGroup')}).
- A group's page: ${L('group.homework')} with results, ${L('group.students')} as a ranking (score over the group's homework, places gained or lost), ${L('group.progress')} charts, ${L('group.skills')}, ${L('group.details')} to edit, the ${L('groups.joinCode')} and ${L('group.newHomework')}.
- ${L('group.showRank')}: when on, students see the whole group ranking in ${L('nav.myWork')} (first name and last initial). Off by default.
- Homework from a group can be given to another group: topic copy.`,
  },
  {
    id: 'practice',
    text: ({ L, t }) => `Practice on what the group gets wrong.
- The group page lists up to 3 skills the group gets under 80% right, each with a button like «${t('practice.button').replace('{skill}', t('skill.grammar')).replace('{n}', '62')}».
- It opens ${L('nav.home')} with a request already written from the group's mistakes (never a student's name). Read it, change it if you like, and send it.`,
  },
  {
    id: 'copy',
    text: ({ L }) => `Giving the same homework to another group.
- On a published homework press ${L('copy.open')}, choose the group (or a new one) and ${L('copy.give')}. Nothing is written again: the group gets its own link, deadline and results, with the same exercises, pictures and recordings.`,
  },
  {
    id: 'student',
    text: ({ L }) => `One student's progress and the parent link.
- Open a student from the group page or the results (${L('report.studentPage')}): results over time against the class average, place in each group, homework on time, trend, skills, AI writing feedback and missing homework.
- ${L('parent.title')}: on the student's page press ${L('parent.create')} and send the link to the parent yourself. The parent sees, without signing up, only your homework results for that child: no classmates' names or places. ${L('parent.revoke')} turns it off at any time.`,
  },
  {
    id: 'kinds',
    text: ({ L }) => `Kinds of exercises the AI can make: ${L('draft.kind.mcq_single')}, ${L('draft.kind.mcq_multi')}, ${L('draft.kind.true_false')} (also Not Given), ${L('draft.kind.gap_fill')}, ${L('draft.kind.matching')}, ${L('draft.kind.ordering')}, ${L('draft.kind.short_answer')}, ${L('draft.kind.open_writing')}, ${L('draft.kind.essay')} and ${L('draft.kind.shadowing')}; reading texts with questions; listening exercises with your recordings or with a voice that reads a word or sentence.
- Pronunciation (${L('skill.pronunciation')}): choose the word you hear, word stress, dictation and shadowing (the student listens and repeats each sentence into the microphone; the AI scores it). Students' voices are never stored.
- Speaking with a live partner isn't available yet.`,
  },
  {
    id: 'exam',
    text: ({ L }) => `Exam-style homework (${L('compose.mode.create')} only).
- Choose the language in ${L('compose.language')}, then an exam in ${L('compose.style')} and its level in ${L('compose.examLevel')}: 수능 영어 (CSAT), TOEIC, IELTS, TOEFL and Cambridge for English; JLPT, HSK, Goethe, TestDaF, DELF/DALF, DELE, ТРКИ, TÖMER, TOPIK and others for other languages. Only exams of the chosen language are listed.
- The AI writes new exercises in the exam's task formats, never real past papers; essays are graded on the exam's official criteria.`,
  },
  {
    id: 'checking',
    text: ({ L }) => `How answers are checked.
- Automatically, the moment the student checks: choices, gaps, matching, ordering, short answers. Typed answers follow the rules of the language taught (e.g. Korean spacing or Arabic vowel marks don't count).
- ${L('profile.typo')}: a one-letter typo in longer words is forgiven. ${L('profile.strictness')}: ${L('profile.strictness.lenient')}, ${L('profile.strictness.standard')} or ${L('profile.strictness.strict')}. Defaults are in Profile → ${L('profile.defaults')}.
- You can always accept another answer in the results (topic results).
- Students on the VIP plan get ${L('tutor.name')}, an AI tutor that explains their own mistake (buttons ${L('tutor.simpler')}, ${L('tutor.anotherExample')}, ${L('tutor.practice')}).`,
  },
  {
    id: 'plans',
    sells: true,
    text: ({ prices }) => `Student plans: the STUDENT's plan decides which exercises of a homework they see; teachers use everything for free.
- Free: vocabulary exercises. Pro: everything except voice work. VIP: everything, with shadowing, the AI tutor and every new feature.
- Prices per student per month: Pro ${prices.monthly.pro ? won(prices.monthly.pro) : 'to be announced'}, VIP ${prices.monthly.vip ? won(prices.monthly.vip) : 'to be announced'}; buying several months at once is cheaper (${Object.entries(prices.periodDiscount)
      .filter(([, d]) => d > 0)
      .map(([m, d]) => `${m} months −${d}%`)
      .join(', ')}).${
      prices.vipGiftUntil ? ` New students who register until ${prices.vipGiftUntil} get ${prices.vipGiftDays} days of VIP as a gift.` : ''
    }
- Students buy a plan themselves on the plans page, or you give your class plans with a package (topic packages).
- A student scores against the exercises of their plan, so a Free student who gets every word right has 100%.`,
  },
  {
    id: 'packages',
    sells: true,
    text: ({ L, prices }) => `Packages: plans for your class (${L('nav.packages')}).
- ${L('packages.buy')}: choose the group, Pro or VIP, how many places and months. A package is always ${prices.teacherDiscount}% cheaper than students buying themselves.
- ${L('packages.howSeats')} A student who already has as good a plan doesn't take a place.
- Until card payment on the website is connected, a package is paid by bank transfer through the 익히미 team in Telegram.`,
  },
  {
    id: 'earnings',
    sells: true,
    text: ({ L, prices }) => `Earnings (${L('nav.earnings')}).
- When a student in one of your groups buys Pro or VIP themselves, ${prices.teacherCommission}% of the payment is yours. From a paid course you made, ${CONFIG.courses.teacherSharePercent}% of every sale is yours.
- The page shows this month, all time, how many students bought, and each payment. The 익히미 team pays it out to you.`,
  },
  {
    id: 'courses',
    text: ({ L }) => `Online courses (${L('nav.courses')}).
- ${L('course.new')} → name → ${L('course.create')}. ${L('course.addLesson')}: a title, a video link (YouTube or Vimeo only: upload the video there, unlisted, and paste the link), notes, and one of your published homeworks. ${L('lesson.preview')} lets anyone watch that lesson.
- ${L('course.visibility')}: ${L('course.visibility.private')} (you and your linked groups only), ${L('course.visibility.unlisted')} (anyone with the link) or ${L('course.visibility.marketplace')} (listed for everyone).
- ${L('course.groups')}: students of the groups you tick get the course free.
- A course open to others needs the admin's approval once: add at least one lesson and press ${L('courseReview.submit')}. You hear the answer in Telegram; a returned course comes with a note, fix it and ${L('courseReview.resubmit')}. Later changes need no new approval. A private course needs none.`,
  },
  {
    id: 'course_price',
    sells: true,
    text: ({ L }) => `A course's price (${L('courseSale.pricing')}).
- ${L('courseSale.planCovered')}: the course is free; its homework opens by each student's own plan, like any homework.
- ${L('courseSale.paid')}: you set the price, at least ${won(CONFIG.courses.minPriceKrw)}. A student buys it once, for life, and does all its homework with every feature whatever their plan; others get only the vocabulary exercises and the preview lessons. ${CONFIG.courses.teacherSharePercent}% of every sale is yours (${L('nav.earnings')}).
- Students buy on the course page through the 익히미 bot in Telegram (bank transfer), never inside the store apps.`,
  },
  {
    id: 'account',
    text: ({ L }) => `Account and settings (Profile).
- Signing in: phone number and password. First time, or forgot the password: confirm with Telegram (the bot asks you to share your number), then set a password in Profile → ${L('password.title')}.
- ${L('link.telegram')}: links your Telegram so you get messages (and so your students get theirs, on their side).
- One account can be both teacher and student: the side open now is shown next to your picture; switch in Profile → ${L('settings.accountType')}.
- Profile also has ${L('profile.defaults')} for new homework, ${L('settings.notifications')}, ${L('settings.export')} and ${L('settings.delete')} (restored if you sign in again within 30 days).
- Changing the phone number isn't available yet.`,
  },
  {
    id: 'problems',
    text: ({ L }) => `When something goes wrong.
- ${L('error.aiBusy')} The AI service is overloaded for a moment; try again in a minute. ${L('error.aiBadOutput')}
- ${L('error.aiTooLong')}
- ${L('error.dailyCap').replace('{n}', String(CONFIG.generationDailyCapPerTeacher))} The limit is ${CONFIG.generationDailyCapPerTeacher} homeworks a day; the team can raise it for you.
- A file that won't upload: it may be too large or an unsupported type; photos, PDF, Word .docx and audio files work.
- A homework or button that doesn't work as described: send the question to the team with the button in this chat.`,
  },
]

/** The page ids the answer may point to, and where they go */
export const HELP_LINKS: Record<string, { href: string; label: MessageKey; sells?: boolean }> = {
  home: { href: '/app', label: 'nav.home' },
  groups: { href: '/app/groups', label: 'nav.groups' },
  reports: { href: '/app/assignments', label: 'nav.reports' },
  courses: { href: '/app/courses', label: 'nav.courses' },
  packages: { href: '/app/packages', label: 'nav.packages', sells: true },
  earnings: { href: '/app/earnings', label: 'nav.earnings', sells: true },
  profile: { href: '/profile', label: 'nav.profile' },
}

/** Every topic id, for Admin's list (names: help.topic.<id>) */
export const HELP_TOPIC_IDS = TOPICS.map((t) => t.id)

/** The guide and the links in the teacher's language (the store apps get nothing about buying) */
export function helpGuide(locale: Locale, opts: { prices: Pricing; store: boolean }) {
  const t = getTranslator(locale)
  // A name with a number in it ("… ({n})") is quoted without the number
  const L = (key: MessageKey) => `«${t(key).replace(/\s*\(\{\w+\}\)|\{\w+\}/g, '').trim()}»`
  const topics = TOPICS.filter((x) => !(opts.store && x.sells)).map((x) => ({ id: x.id, text: x.text({ L, t, prices: opts.prices }) }))
  const links = Object.entries(HELP_LINKS)
    .filter(([, l]) => !(opts.store && l.sells))
    .map(([id, l]) => ({ id, label: t(l.label) }))
  return { topics, links }
}

/** Where the teacher is, in a few words for the model, and which suggestions the empty chat shows */
export type HelpPlace = 'home' | 'draft' | 'report' | 'group' | 'course' | 'other'
export function helpPlace(path: string): { place: HelpPlace; about: string } {
  const p = path.split('?')[0]!.replace(/\/+$/, '') || '/'
  if (p === '/app') return { place: 'home', about: 'the home page with the chat box where homework is made' }
  if (/^\/app\/a\/[^/]+\/report$/.test(p)) return { place: 'report', about: "a homework's results page" }
  if (/^\/app\/a\/[^/]+$/.test(p)) return { place: 'draft', about: "a homework's page: the draft before publishing, or the published homework" }
  if (p === '/app/assignments') return { place: 'other', about: 'the list of all homework, group by group' }
  if (p === '/app/groups') return { place: 'group', about: 'the list of groups' }
  if (/^\/app\/groups\/[^/]+$/.test(p)) return { place: 'group', about: "a group's page" }
  if (/^\/app\/students\/[^/]+$/.test(p)) return { place: 'other', about: "one student's progress page" }
  if (p === '/app/courses') return { place: 'course', about: 'the list of online courses' }
  if (/^\/app\/courses\/[^/]+$/.test(p)) return { place: 'course', about: "an online course's editor" }
  if (p === '/app/packages') return { place: 'other', about: 'the packages page' }
  if (p === '/app/earnings') return { place: 'other', about: 'the earnings page' }
  if (p === '/profile') return { place: 'other', about: 'Profile and settings' }
  return { place: 'other', about: 'a page of 익히미' }
}
