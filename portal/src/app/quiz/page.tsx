import type { Metadata } from 'next';

import { QuizFlow } from '@/components/QuizFlow';

export const metadata: Metadata = {
  title: 'Retirement Health Score',
  description:
    'Eight questions, two minutes, an instant score out of 100 with a personalised breakdown of where your retirement plan stands.',
};

export default function QuizPage() {
  return <QuizFlow />;
}
