/**
 * The eight Retirement Health Score questions.
 *
 * Three of them (age band, employment type, biggest worry) carry no points —
 * they set the benchmark the answers are measured against and drive
 * segmentation tags. The other five are scored. See ./scoring.ts.
 */

/**
 * Stamped into metadata.quiz on every quiz funnel event so a future second
 * quiz (e.g. Family Protection Score) cannot contaminate the retirement
 * funnel — quiz_funnel filters on it (0004), with legacy events defaulting
 * to this slug via coalesce.
 */
export const QUIZ_SLUG = 'retirement_health_score';

export const QUESTION_IDS = [
  'ageBand',
  'employmentType',
  'savingsBand',
  'monthlySavingsRate',
  'retirementVehicle',
  'lifeCover',
  'debtLevel',
  'biggestWorry',
] as const;

export type QuestionId = (typeof QUESTION_IDS)[number];

export interface QuizOption {
  value: string;
  label: string;
  /** Shown under the label on mobile to remove ambiguity. */
  hint?: string;
}

export interface QuizQuestion {
  id: QuestionId;
  /** 1-based position in the flow. */
  step: number;
  question: string;
  /** Short line explaining why we ask — builds trust, lifts completion. */
  why: string;
  options: QuizOption[];
  /** false for the three contextual questions that carry no points. */
  scored: boolean;
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'ageBand',
    step: 1,
    scored: false,
    question: 'Which age band are you in?',
    why: 'Your age sets the benchmark we measure your savings against.',
    options: [
      { value: 'under_30', label: 'Under 30' },
      { value: '30_39', label: '30 – 39' },
      { value: '40_49', label: '40 – 49' },
      { value: '50_59', label: '50 – 59' },
      { value: '60_plus', label: '60 or older' },
    ],
  },
  {
    id: 'employmentType',
    step: 2,
    scored: false,
    question: 'How are you currently employed?',
    why: 'Public-sector and self-employed retirement planning work differently.',
    options: [
      { value: 'private_sector', label: 'Private sector employee' },
      {
        value: 'public_sector_gepf',
        label: 'Public sector (GEPF member)',
        hint: 'Government, SAPS, education, health, municipal',
      },
      { value: 'self_employed', label: 'Self-employed or business owner' },
      { value: 'contractor', label: 'Contract or freelance' },
      { value: 'not_working', label: 'Not currently working or retired' },
    ],
  },
  {
    id: 'savingsBand',
    step: 3,
    scored: true,
    question: 'Roughly how much have you saved for retirement so far?',
    why: 'The single biggest driver of your score. An estimate is fine.',
    options: [
      { value: 'none', label: 'Nothing yet' },
      { value: 'under_250k', label: 'Under R250 000' },
      { value: '250k_1m', label: 'R250 000 – R1 million' },
      { value: '1m_3m', label: 'R1 million – R3 million' },
      { value: '3m_plus', label: 'More than R3 million' },
    ],
  },
  {
    id: 'monthlySavingsRate',
    step: 4,
    scored: true,
    question: 'What share of your monthly income goes towards retirement?',
    why: 'Includes your own contributions and anything your employer adds.',
    options: [
      { value: 'none', label: "I'm not saving right now" },
      { value: 'under_5', label: 'Less than 5%' },
      { value: '5_10', label: '5% – 10%' },
      { value: '10_15', label: '10% – 15%' },
      { value: '15_plus', label: 'More than 15%' },
    ],
  },
  {
    id: 'retirementVehicle',
    step: 5,
    scored: true,
    question: 'Do you have a retirement annuity or pension fund?',
    why: 'Tells us whether your savings are in a tax-efficient structure.',
    options: [
      { value: 'none', label: 'Neither' },
      { value: 'employer_fund_only', label: 'Employer pension or provident fund only' },
      { value: 'ra_only', label: 'Retirement annuity only' },
      { value: 'both', label: 'Both an employer fund and an RA' },
      { value: 'unsure', label: "I'm not sure what I have" },
    ],
  },
  {
    id: 'lifeCover',
    step: 6,
    scored: true,
    question: 'What life cover do you have in place?',
    why: 'Retirement plans fall over when a breadwinner is not covered.',
    options: [
      { value: 'none', label: 'No life cover' },
      { value: 'group_only', label: 'Group cover through my employer only' },
      { value: 'personal', label: 'My own personal cover' },
      { value: 'personal_reviewed', label: 'My own cover, reviewed in the last 2 years' },
      { value: 'unsure', label: "I'm not sure" },
    ],
  },
  {
    id: 'debtLevel',
    step: 7,
    scored: true,
    question: 'How would you describe your current debt?',
    why: 'Debt repayments compete directly with retirement contributions.',
    options: [
      { value: 'none', label: 'No debt, or only a bond I am comfortable with' },
      { value: 'manageable', label: 'Some debt, comfortably managed' },
      { value: 'moderate', label: 'Enough that it limits what I can save' },
      { value: 'high', label: 'High — repayments are a strain' },
      { value: 'overwhelming', label: 'I am falling behind on repayments' },
    ],
  },
  {
    id: 'biggestWorry',
    step: 8,
    scored: false,
    question: 'What worries you most about your finances right now?',
    why: 'So your report leads with what actually matters to you.',
    options: [
      { value: 'outliving_savings', label: 'Outliving my retirement savings' },
      { value: 'not_saving_enough', label: 'Not saving enough each month' },
      { value: 'family_protection', label: 'My family being unprotected if something happens to me' },
      { value: 'debt', label: 'Getting on top of my debt' },
      { value: 'not_knowing', label: "Not knowing whether I'm on track at all" },
    ],
  },
];

export const QUESTIONS_BY_ID: Record<QuestionId, QuizQuestion> = Object.fromEntries(
  QUIZ_QUESTIONS.map((q) => [q.id, q]),
) as Record<QuestionId, QuizQuestion>;

/** Human-readable answer label, for the report and the advisor briefing. */
export function labelFor(questionId: QuestionId, value: string): string {
  const option = QUESTIONS_BY_ID[questionId]?.options.find((o) => o.value === value);
  return option?.label ?? value;
}
