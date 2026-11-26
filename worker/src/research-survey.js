// The performer research questionnaire. One source of truth:
// the worker serves it to the page, and the worker checks every submission against it.
//
// Question types
//   single      one option from `options`. An option with other:true reveals a text field.
//   multi       any number of `options`. exclusive:true options clear the others.
//   text        free text, optional unless optional:false.
//   text_or_none  free text, or the `noneLabel` choice that makes the text unnecessary.
//
// showIf is a condition on earlier answers. Question ids are never shown to participants.
//   { q, in: [...] }      single: value is one of the list. multi: any selected value is in the list.
//   { q, notIn: [...] }   single: an answer exists and its value is not in the list.
//   { q, answered: true } the question has been answered (not skipped).
//   { q, mode: 'text' }   text_or_none: the participant wrote text.
//   { anyOf: [...] }      any of the conditions is true.
//   { allOf: [...] }      every condition is true.

export const SURVEY_VERSION = '2026-11-26.1';

export const SECTIONS = {
  s1: 'Your experience',
  s2: 'Audience growth',
  s3: 'Your priorities',
  s4: 'Working with other performers',
  s5: 'Earnings and spending',
  s6: 'What should exist?',
  s7: 'Future research',
};

const GROWTH_DIFFICULTY = ['few_discover', 'leave_quickly', 'regulars_less_active', 'fluctuates'];
const SHARED_EARNINGS = ['equal', 'percentages', 'fixed_payment', 'studio_handled'];
const COLLAB_YES = ['yes_regular', 'yes_occasional', 'yes_once'];
const STAGNANT = ['declined_slightly', 'declined_significantly', 'stayed_same'];

export const QUESTIONS = [
  // Section 1
  {
    id: 'Q01', section: 's1', type: 'single', text: 'How long have you been camming?',
    options: [
      { v: 'lt_1_month', label: 'Less than one month' },
      { v: '1_6_months', label: '1–6 months' },
      { v: '6_12_months', label: '6–12 months' },
      { v: '1_3_years', label: '1–3 years' },
      { v: '3_5_years', label: '3–5 years' },
      { v: 'gt_5_years', label: 'More than 5 years' },
    ],
  },
  {
    id: 'Q02', section: 's1', type: 'single', text: 'How often have you broadcast during the past 30 days?',
    options: [
      { v: 'almost_daily', label: 'Almost every day' },
      { v: '3_5_week', label: '3–5 days a week' },
      { v: '1_2_week', label: '1–2 days a week' },
      { v: 'occasionally', label: 'Occasionally' },
      { v: 'not_at_all', label: 'Not at all' },
    ],
  },
  {
    // Shown to people who have not broadcast in the past 30 days.
    id: 'Q02a', section: 's1', type: 'single', text: 'When did you last broadcast?',
    showIf: { q: 'Q02', in: ['not_at_all'] },
    options: [
      { v: 'within_3_months', label: 'Within the last 3 months' },
      { v: '3_6_months', label: '3–6 months ago' },
      { v: '6_12_months', label: '6–12 months ago' },
      { v: 'over_12_months', label: 'More than 12 months ago' },
      { v: 'prefer_not', label: 'Prefer not to answer' },
    ],
  },
  {
    id: 'Q03', section: 's1', type: 'multi', text: 'Which platforms do you currently broadcast on?',
    options: [
      { v: 'chaturbate', label: 'Chaturbate' },
      { v: 'stripchat', label: 'Stripchat' },
      { v: 'myfreecams', label: 'MyFreeCams' },
      { v: 'livejasmin', label: 'LiveJasmin' },
      { v: 'streamate', label: 'Streamate' },
      { v: 'other', label: 'Other', other: true },
      { v: 'not_broadcasting', label: 'Not currently broadcasting', exclusive: true },
    ],
  },
  {
    id: 'Q04', section: 's1', type: 'single',
    text: 'How many viewers are typically in your Chaturbate room at any given time?',
    help: 'We are interested in your typical room size, not your highest viewer count.',
    options: [
      { v: '0_9', label: '0–9' },
      { v: '10_24', label: '10–24' },
      { v: '25_49', label: '25–49' },
      { v: '50_99', label: '50–99' },
      { v: '100_249', label: '100–249' },
      { v: '250_499', label: '250–499' },
      { v: '500_plus', label: '500+' },
      { v: 'varies', label: 'It varies too much to estimate' },
      { v: 'dont_know', label: "I don't know" },
    ],
  },
  {
    id: 'Q05', section: 's1', type: 'single', text: 'Compared with three months ago, how has your audience changed?',
    options: [
      { v: 'grew_significantly', label: 'Grown significantly' },
      { v: 'grew_slightly', label: 'Grown slightly' },
      { v: 'stayed_same', label: 'Stayed about the same' },
      { v: 'declined_slightly', label: 'Declined slightly' },
      { v: 'declined_significantly', label: 'Declined significantly' },
      { v: 'not_long_enough', label: "I haven't been broadcasting long enough to compare" },
      { v: 'dont_know', label: "I don't know" },
    ],
  },

  // Section 2
  {
    id: 'Q06', section: 's2', type: 'text', optional: true,
    text: "Think about a recent broadcast that didn't go as well as you hoped. What happened, and what do you think contributed to the result?",
    textInactive: "Think about a broadcast from when you were last active that didn't go as well as you hoped. What happened, and what do you think contributed to the result?",
  },
  {
    id: 'Q07', section: 's2', type: 'text', optional: true,
    text: 'Think about a broadcast that went unusually well. What was different that day?',
    textInactive: 'Think about a broadcast from when you were last active that went unusually well. What was different that day?',
  },
  {
    id: 'Q08', section: 's2', type: 'multi', shuffle: true,
    text: 'Which of the following situations have you personally experienced in the past 30 days?',
    options: [
      { v: 'few_discover', label: 'Very few people discover or enter my room.' },
      { v: 'leave_quickly', label: 'People enter my room but leave quickly.' },
      { v: 'watch_rarely_interact', label: 'People watch but rarely interact.' },
      { v: 'interact_rarely_spend', label: 'People interact but rarely spend money.' },
      { v: 'spend_rarely_return', label: 'People spend money but rarely return.' },
      { v: 'regulars_less_active', label: 'My regular viewers are becoming less active.' },
      { v: 'fluctuates', label: "My audience fluctuates for reasons I don't understand." },
      { v: 'busy_room', label: 'I have trouble managing my audience when the room gets busy.' },
      { v: 'cant_tell', label: "I can't reliably tell what's happening." },
      { v: 'none', label: 'None of these.', exclusive: true, anchor: true },
      { v: 'other', label: 'Other.', other: true, anchor: true },
    ],
  },
  {
    id: 'Q09', section: 's2', type: 'text_or_none', text: 'What was the last thing you deliberately changed or tried to improve your results?',
    noneLabel: "I haven't tried anything recently.",
  },
  {
    id: 'Q09a', section: 's2', type: 'single', text: 'Did it work?',
    showIf: { q: 'Q09', mode: 'text' },
    options: [
      { v: 'yes', label: 'Yes' },
      { v: 'partially', label: 'Partially' },
      { v: 'no', label: 'No' },
      { v: 'too_early', label: 'Too early to tell' },
      { v: 'couldnt_tell', label: "I couldn't determine whether it worked" },
    ],
  },
  {
    id: 'Q09b', section: 's2', type: 'text', optional: true, text: 'How did you determine whether it worked?',
    showIf: { allOf: [{ q: 'Q09', mode: 'text' }, { q: 'Q09a', answered: true }] },
  },
  {
    id: 'Q10', section: 's2', type: 'multi', text: "How do you currently know why someone visits your room rather than another performer's room?",
    options: [
      { v: 'viewers_tell', label: 'Viewers sometimes tell me.' },
      { v: 'traffic_sources', label: 'I can see where some of my traffic comes from.' },
      { v: 'experiment', label: 'I experiment and compare my results.' },
      { v: 'intuition', label: 'I rely on my experience and intuition.' },
      { v: 'dont_know', label: "I don't really know.", exclusive: true },
      { v: 'other', label: 'Other.', other: true },
    ],
  },
  {
    id: 'Q11', section: 's2', type: 'text', optional: true,
    text: "If your audience isn't growing as much as you'd like, what have you considered doing but haven't tried yet? What has stopped you?",
    showIf: {
      anyOf: [
        { q: 'Q05', in: STAGNANT },
        { q: 'Q08', in: GROWTH_DIFFICULTY },
      ],
    },
  },

  // Section 3
  {
    id: 'Q12', section: 's3', type: 'single', shuffle: true,
    text: 'If you could achieve only ONE of these outcomes over the next three months, which would you choose?',
    options: [
      { v: 'discovery', label: 'More people discovering my room' },
      { v: 'longer_stay', label: 'Visitors staying longer' },
      { v: 'paying', label: 'More viewers becoming paying customers' },
      { v: 'returning', label: 'More viewers returning regularly' },
      { v: 'existing_earnings', label: 'Higher earnings from my existing audience' },
      { v: 'less_time', label: 'Less time working for the same income' },
      { v: 'predictable', label: 'More predictable earnings' },
      { v: 'privacy_safety', label: 'Greater privacy and safety' },
      { v: 'less_work', label: 'Less work managing my broadcasts' },
      { v: 'something_else', label: 'Something else', other: true, anchor: true },
    ],
  },
  { id: 'Q13', section: 's3', type: 'text', optional: true, text: 'What information do you wish you had about your audience or your performance that you cannot easily get today?' },
  { id: 'Q14', section: 's3', type: 'text', optional: true, text: 'What is something you wish you could do as a performer that you currently have no practical way of doing?' },
  { id: 'Q15', section: 's3', type: 'text', optional: true, text: 'If you could eliminate one responsibility from your working day without negatively affecting your earnings or audience relationships, what would it be?' },
  { id: 'Q16', section: 's3', type: 'text', optional: true, text: 'What part of your work would you never want software or another person to take over?' },

  // Section 4
  {
    id: 'Q17', section: 's4', type: 'single', text: 'Have you ever broadcast with another performer?',
    options: [
      { v: 'yes_regular', label: 'Yes, regularly' },
      { v: 'yes_occasional', label: 'Yes, occasionally' },
      { v: 'yes_once', label: 'Yes, once or twice' },
      { v: 'no_considered', label: "No, but I've considered it" },
      { v: 'no_not_considered', label: "No, and I haven't considered it" },
    ],
  },
  {
    id: 'Q18', section: 's4', type: 'multi', text: 'Think about the last time you broadcast with another performer. How was the broadcast organized?',
    showIf: { q: 'Q17', in: COLLAB_YES },
    options: [
      { v: 'one_location', label: 'We broadcast from one location.' },
      { v: 'different_locations', label: 'We broadcast from different locations.' },
      { v: 'one_account', label: 'We used one broadcasting account.' },
      { v: 'multiple_accounts', label: 'We used multiple broadcasting accounts.' },
      { v: 'someone_else', label: 'Someone else organized the broadcast.' },
      { v: 'other', label: 'Other.', other: true },
    ],
  },
  {
    id: 'Q18a', section: 's4', type: 'single', optional: true, text: 'How many performers participated?',
    showIf: { allOf: [{ q: 'Q17', in: COLLAB_YES }, { q: 'Q18', answered: true }] },
    options: [
      { v: 'two', label: 'Two' },
      { v: 'three', label: 'Three' },
      { v: 'four_plus', label: 'Four or more' },
      { v: 'prefer_not', label: 'Prefer not to answer' },
    ],
  },
  {
    id: 'Q19', section: 's4', type: 'single', text: 'How did you decide how to divide the earnings?',
    showIf: { q: 'Q17', in: COLLAB_YES },
    options: [
      { v: 'equal', label: 'We divided everything equally.' },
      { v: 'percentages', label: 'We agreed on different percentages.' },
      { v: 'own_account', label: 'Each performer kept the earnings received through their own account.' },
      { v: 'fixed_payment', label: 'Someone received a fixed payment.' },
      { v: 'studio_handled', label: 'A studio or organizer handled payment.' },
      { v: 'no_agreement', label: 'We did not have a clear agreement.' },
      { v: 'not_shared', label: 'Earnings were not shared.' },
      { v: 'other', label: 'Other.', other: true },
      { v: 'prefer_not', label: 'Prefer not to answer.' },
    ],
  },
  {
    id: 'Q19a', section: 's4', type: 'text', optional: true,
    text: 'How did you calculate what each person was owed?',
    showIf: { q: 'Q19', in: SHARED_EARNINGS },
  },
  {
    id: 'Q20', section: 's4', type: 'text', optional: true,
    text: 'What was the most difficult part of working together?',
    showIf: { q: 'Q17', in: COLLAB_YES },
  },
  {
    id: 'Q20a', section: 's4', type: 'multi', optional: true,
    text: 'Which of these were difficult?',
    showIf: { q: 'Q17', in: COLLAB_YES },
    options: [
      { v: 'finding_collaborator', label: 'Finding someone to collaborate with' },
      { v: 'schedules', label: 'Coordinating schedules' },
      { v: 'organizing', label: 'Organizing the broadcast' },
      { v: 'multiple_accounts', label: 'Managing multiple accounts' },
      { v: 'equipment', label: 'Managing technical equipment' },
      { v: 'interactions', label: 'Keeping track of audience interactions' },
      { v: 'compensation', label: 'Agreeing on compensation' },
      { v: 'earnings_split', label: 'Determining what each performer earned' },
      { v: 'payment_after', label: 'Receiving payment afterward' },
      { v: 'boundaries', label: 'Maintaining privacy or professional boundaries' },
      { v: 'nothing_difficult', label: 'Nothing was particularly difficult', exclusive: true },
      { v: 'other', label: 'Other', other: true },
    ],
  },
  {
    id: 'Q21', section: 's4', type: 'single', text: 'Did collaborating have any lasting effect on your own audience?',
    showIf: { q: 'Q17', in: COLLAB_YES },
    options: [
      { v: 'increased', label: 'My audience increased.' },
      { v: 'returning', label: 'I gained some returning viewers.' },
      { v: 'same', label: 'My audience remained about the same.' },
      { v: 'decreased', label: 'My audience decreased.' },
      { v: 'couldnt_tell', label: "I couldn't determine whether it had an effect." },
    ],
  },
  {
    id: 'Q21a', section: 's4', type: 'text', optional: true, text: 'What makes you believe that?',
    showIf: { allOf: [{ q: 'Q17', in: COLLAB_YES }, { q: 'Q21', answered: true }] },
  },
  {
    id: 'Q22', section: 's4', type: 'single', text: 'Have you ever had a disagreement or difficulty regarding earnings from a collaborative broadcast?',
    showIf: { q: 'Q17', in: COLLAB_YES },
    options: [
      { v: 'yes', label: 'Yes' },
      { v: 'no', label: 'No' },
      { v: 'prefer_not', label: 'Prefer not to answer' },
    ],
  },
  {
    id: 'Q22a', section: 's4', type: 'text', optional: true,
    text: 'Without identifying anyone, what caused the difficulty, and how was it resolved?',
    showIf: { q: 'Q22', in: ['yes'] },
  },
  {
    id: 'Q23', section: 's4', type: 'single', text: 'Have you ever considered collaborating with another performer but ultimately decided against it?',
    options: [
      { v: 'yes', label: 'Yes' },
      { v: 'no', label: 'No' },
      { v: 'never_considered', label: 'I have never considered collaborating' },
    ],
  },
  {
    id: 'Q23a', section: 's4', type: 'multi', optional: true,
    text: 'What prevented you from going ahead?',
    showIf: { q: 'Q23', in: ['yes'] },
    options: [
      { v: 'finding', label: 'Difficulty finding a suitable collaborator' },
      { v: 'scheduling', label: 'Scheduling' },
      { v: 'distance', label: 'Geographic distance' },
      { v: 'technical', label: 'Technical complexity' },
      { v: 'privacy', label: 'Privacy or safety concerns' },
      { v: 'compensation', label: 'Uncertainty about compensation' },
      { v: 'benefit', label: 'Uncertainty about whether collaboration would benefit me' },
      { v: 'independent', label: 'Preference for working independently' },
      { v: 'other', label: 'Other', other: true },
    ],
  },
  {
    id: 'Q23b', section: 's4', type: 'text', optional: true,
    text: 'Anything else you would like to add about what prevented you?',
    showIf: { q: 'Q23', in: ['yes'] },
  },
  {
    id: 'Q24', section: 's4', type: 'multi_text', optional: true,
    text: 'What, if anything, would make you more interested in collaborating with other performers?',
    options: [
      { v: 'nothing', label: 'Nothing. I prefer working independently.', exclusive: true },
      { v: 'satisfied', label: "I'm satisfied with how I currently collaborate.", exclusive: true },
      { v: 'dont_know', label: "I don't know.", exclusive: true },
    ],
  },

  // Section 5
  {
    id: 'Q25', section: 's5', type: 'single', optional: true,
    text: 'Approximately how much do you earn from camming in a typical month, after platform or studio deductions but before taxes?',
    help: 'USD equivalent.',
    options: [
      { v: 'lt_100', label: 'Under $100' },
      { v: '100_499', label: '$100–499' },
      { v: '500_999', label: '$500–999' },
      { v: '1000_2499', label: '$1,000–2,499' },
      { v: '2500_4999', label: '$2,500–4,999' },
      { v: '5000_9999', label: '$5,000–9,999' },
      { v: '10000_plus', label: '$10,000+' },
      { v: 'varies', label: 'It varies too much to estimate' },
      { v: 'prefer_not', label: 'Prefer not to answer', exclusive: true },
    ],
  },
  {
    id: 'Q26', section: 's5', type: 'single', optional: true, text: 'How financially dependent are you on camming?',
    options: [
      { v: 'only_income', label: 'It is my only source of income.' },
      { v: 'primary_income', label: 'It is my primary source of income.' },
      { v: 'supplements', label: 'It supplements another source of income.' },
      { v: 'occasional', label: 'I do it occasionally for additional money.' },
      { v: 'prefer_not', label: 'Prefer not to answer.', exclusive: true },
    ],
  },
  {
    id: 'Q27', section: 's5', type: 'single', optional: true,
    text: 'Approximately how much did you personally spend on software and online services specifically for camming during the past 30 days?',
    help: 'Exclude equipment and ordinary internet service.',
    options: [
      { v: 'nothing', label: 'Nothing' },
      { v: '1_10', label: '$1–10' },
      { v: '11_25', label: '$11–25' },
      { v: '26_50', label: '$26–50' },
      { v: '51_100', label: '$51–100' },
      { v: '101_250', label: '$101–250' },
      { v: 'over_250', label: 'More than $250' },
      { v: 'someone_else', label: 'Someone else pays for my tools.' },
      { v: 'dont_know', label: "I don't know." },
      { v: 'prefer_not', label: 'Prefer not to answer.', exclusive: true },
    ],
  },
  {
    id: 'Q28', section: 's5', type: 'text_or_none', optional: true,
    text: 'What was the last thing you paid for specifically because you believed it would improve your results as a performer?',
    noneLabel: "I haven't paid for anything for this purpose.",
  },
  {
    id: 'Q28a', section: 's5', type: 'text', optional: true, text: 'Approximately how much did it cost?',
    showIf: { q: 'Q28', mode: 'text' },
  },
  {
    id: 'Q28b', section: 's5', type: 'text', optional: true, text: 'What improvement were you expecting, and did you achieve it?',
    showIf: { q: 'Q28', mode: 'text' },
  },
  {
    id: 'Q29', section: 's5', type: 'single', optional: true,
    text: 'Have you considered paying for something to help with camming but ultimately decided against it?',
    options: [
      { v: 'yes', label: 'Yes' },
      { v: 'no', label: 'No' },
      { v: 'dont_remember', label: "I don't remember" },
    ],
  },
  {
    id: 'Q29a', section: 's5', type: 'text', optional: true, text: "What was it, and why didn't you buy it?",
    showIf: { q: 'Q29', in: ['yes'] },
  },
  {
    id: 'Q30', section: 's5', type: 'single', optional: true,
    text: 'If you discovered something you genuinely believed would improve your results, which best describes your financial situation?',
    options: [
      { v: 'comfortable', label: 'I could comfortably pay for something additional.' },
      { v: 'replace_expense', label: 'I would need to replace an existing expense.' },
      { v: 'earn_more_first', label: 'I would need to earn more before spending additional money.' },
      { v: 'cannot_justify', label: 'I could not justify spending anything additional right now.' },
      { v: 'depends', label: 'It depends on the expense and expected results.' },
      { v: 'prefer_not', label: 'Prefer not to answer.', exclusive: true },
    ],
  },
  {
    id: 'Q31', section: 's5', type: 'single', optional: true,
    text: 'Who normally decides which professional tools you use and pays for them?',
    options: [
      { v: 'decide_pay', label: 'I decide and pay.' },
      { v: 'decide_other_pays', label: 'I decide, but someone else pays.' },
      { v: 'other_decides_i_pay', label: 'Someone else decides, but I pay.' },
      { v: 'studio_decides', label: 'A studio or manager decides and pays.' },
      { v: 'together', label: 'We decide together.' },
      { v: 'other', label: 'Other.', other: true },
      { v: 'prefer_not', label: 'Prefer not to answer.', exclusive: true },
    ],
  },

  // Section 6
  { id: 'Q32', section: 's6', type: 'text', optional: true, text: 'Imagine someone could invent one completely new tool or service specifically for performers. What would you want it to do?' },
  { id: 'Q33', section: 's6', type: 'text', optional: true, text: 'What do you think people who build software for cam performers fundamentally misunderstand about your work?' },
  { id: 'Q34', section: 's6', type: 'text', optional: true, text: "Is there anything we haven't asked that you think we should understand about being a performer?" },

  // Section 7: asked after submission
  {
    id: 'F01', section: 's7', type: 'multi', optional: true,
    text: 'Would you be interested in participating in future performer research?',
    options: [
      { v: 'anonymous_surveys', label: 'Additional anonymous surveys' },
      { v: 'text_conversations', label: 'Private text conversations' },
      { v: 'video_conversations', label: 'One-on-one video or audio conversations' },
      { v: 'group_discussions', label: 'Group discussions with other performers' },
      { v: 'experimental_tools', label: 'Testing experimental tools' },
      { v: 'local_events', label: 'Local research events' },
      { v: 'no_thanks', label: 'No, thank you', exclusive: true },
    ],
  },
];

export const QUESTION_BY_ID = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));

// Questions a participant answers before submitting. F01 is asked after.
export const RESEARCH_QUESTIONS = QUESTIONS.filter(q => q.id !== 'F01');

// True when a condition holds for the given answers.
// An answer has the shape { state: 'answered' | 'skipped' | 'unanswered', value?, values?, text? }.
export function holds(cond, answers) {
  if (cond.anyOf) return cond.anyOf.some(c => holds(c, answers));
  if (cond.allOf) return cond.allOf.every(c => holds(c, answers));
  const a = answers[cond.q];
  if (!a || a.state !== 'answered') return false;
  if (cond.answered) return true;
  if (cond.mode) return a.mode === cond.mode;
  if (cond.in) {
    if (Array.isArray(a.values)) return a.values.some(v => cond.in.includes(v));
    return cond.in.includes(a.value);
  }
  if (cond.notIn) return !cond.notIn.includes(a.value);
  return false;
}

// The ids of questions that apply, given the answers so far.
// A question is applicable when its condition holds. Its parent's answer must exist for that.
export function applicableIds(answers) {
  const out = new Set();
  for (const q of RESEARCH_QUESTIONS) {
    if (!q.showIf || holds(q.showIf, answers)) out.add(q.id);
  }
  return out;
}

// Removes answers to questions that no longer apply. Repeats until nothing changes,
// because clearing one answer can remove the condition for another.
export function pruneAnswers(answers) {
  let current = { ...answers };
  for (;;) {
    const applicable = applicableIds(current);
    const next = {};
    for (const [id, a] of Object.entries(current)) if (applicable.has(id)) next[id] = a;
    if (Object.keys(next).length === Object.keys(current).length) return next;
    current = next;
  }
}

export const LIMITS = { text: 2000, other: 300 };

// Trims text and removes control characters, keeping line breaks.
export function cleanText(s) {
  return String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

// Checks one answer against its question. Returns an error string or null.
export function checkAnswer(q, a) {
  if (!a || typeof a !== 'object') return 'Answer is malformed';
  if (a.state === 'skipped') return q.optional ? null : 'This question cannot be skipped';
  if (a.state !== 'answered') return 'Answer state is not valid';

  const optionValues = (q.options || []).map(o => o.v);
  const needsOther = (v) => (q.options || []).find(o => o.v === v && o.other);

  if (q.type === 'text') {
    if (typeof a.text !== 'string') return 'Text is required';
    if (a.text.length > LIMITS.text) return 'Text is too long';
    if (!cleanText(a.text) && !q.optional) return 'Text is required';
    return null;
  }

  if (q.type === 'text_or_none') {
    if (a.mode === 'none') return null;
    if (a.mode !== 'text') return 'Choose an answer or the "none" option';
    if (typeof a.text !== 'string' || !cleanText(a.text)) return 'Text is required';
    if (a.text.length > LIMITS.text) return 'Text is too long';
    return null;
  }

  if (q.type === 'single') {
    if (!optionValues.includes(a.value)) return 'Choose one of the options';
    if (needsOther(a.value)) {
      if (a.text !== undefined && (typeof a.text !== 'string' || a.text.length > LIMITS.other)) return 'Other text is too long';
    } else if (a.text !== undefined) return 'Unexpected text';
    return null;
  }

  if (q.type === 'multi' || q.type === 'multi_text') {
    const values = Array.isArray(a.values) ? a.values : [];
    const hasText = typeof a.text === 'string' && cleanText(a.text) !== '';
    if (values.length === 0 && !(q.type === 'multi_text' && hasText)) {
      return q.type === 'multi_text' ? 'Choose an option or write an answer' : 'Choose at least one option';
    }
    if (new Set(values).size !== values.length) return 'Duplicate option';
    for (const v of values) if (!optionValues.includes(v)) return 'Choose from the options';
    const exclusive = (q.options || []).filter(o => o.exclusive).map(o => o.v);
    if (values.some(v => exclusive.includes(v)) && values.length > 1) {
      return 'An exclusive option cannot be combined with others';
    }
    if (q.type === 'multi_text') {
      if (a.text !== undefined && (typeof a.text !== 'string' || a.text.length > LIMITS.text)) return 'Text is too long';
    } else if (values.some(v => needsOther(v))) {
      if (a.text !== undefined && (typeof a.text !== 'string' || a.text.length > LIMITS.other)) return 'Other text is too long';
    } else if (a.text !== undefined) return 'Unexpected text';
    return null;
  }

  return 'Unknown question type';
}

// Checks a whole response.
// mode 'progress': answers may be incomplete, so required questions can be missing.
// mode 'submit': every applicable required question must be answered or skipped.
export function checkResponse(answers, mode) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return 'Answers are malformed';
  for (const id of Object.keys(answers)) {
    if (!QUESTION_BY_ID[id] || id === 'F01') return `Unknown question ${id}`;
  }
  const applicable = applicableIds(answers);
  for (const id of Object.keys(answers)) {
    if (!applicable.has(id)) return `Answer given to a question that does not apply`;
  }
  for (const id of applicable) {
    const q = QUESTION_BY_ID[id];
    const a = answers[id];
    if (!a) {
      if (mode === 'submit' && !q.optional) return 'A required question is unanswered';
      continue;
    }
    const err = checkAnswer(q, a);
    if (err) return err;
  }
  return null;
}

// Builds the stored record: every research question gets a state.
// Applicable questions take their answer state. Others are not_applicable.
export function normalise(answers) {
  const applicable = applicableIds(answers);
  const out = {};
  for (const q of RESEARCH_QUESTIONS) {
    if (!applicable.has(q.id)) { out[q.id] = { state: 'not_applicable' }; continue; }
    const a = answers[q.id];
    if (!a) { out[q.id] = { state: 'unanswered' }; continue; }
    if (a.state === 'skipped') { out[q.id] = { state: 'skipped' }; continue; }
    const rec = { state: 'answered' };
    if (a.value !== undefined) rec.value = a.value;
    if (a.values !== undefined) rec.values = a.values;
    if (a.mode !== undefined) rec.mode = a.mode;
    if (a.text !== undefined) rec.text = cleanText(a.text);
    out[q.id] = rec;
  }
  return out;
}

// The questionnaire as the page receives it. Conditions are included so the page can apply them;
// question ids are used by the page internally and are never printed to the participant.
export function publicSurvey() {
  return {
    version: SURVEY_VERSION,
    sections: SECTIONS,
    questions: QUESTIONS.map(q => {
      const { showIf, ...rest } = q;
      return { ...rest, showIf };
    }),
  };
}
