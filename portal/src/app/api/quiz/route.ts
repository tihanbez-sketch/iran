/**
 * POST /api/quiz
 *
 * Scores a completed Retirement Health Score quiz and returns the score,
 * the visual breakdown and three compliance-screened insight bullets.
 *
 * Deliberately resilient: a Supabase outage stops us recording the event but
 * must never stop the visitor seeing their result. Insight generation has its
 * own template fallback (see src/lib/insights.ts).
 */

import { NextResponse } from 'next/server';

import { generateInsights } from '@/lib/insights';
import { qualifiesAsReturnVisit } from '@/lib/lead-scoring';
import { scoreQuiz, type QuizAnswers } from '@/lib/scoring';
import { isSupabaseConfigured, lastEventAtForSession, recordEvent } from '@/lib/supabase';
import { compactAttribution, fieldErrors, quizSubmissionSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = quizSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please answer every question', fields: fieldErrors(parsed.error) },
      { status: 400 },
    );
  }

  const { answers, sessionId } = parsed.data;
  const attribution = compactAttribution(parsed.data.attribution);
  const result = scoreQuiz(answers as QuizAnswers);
  const insights = await generateInsights(answers as QuizAnswers, result);

  if (insights.degradedReason) {
    // Operational signal, not visitor-facing.
    console.warn('[insights] degraded to templates:', insights.degradedReason);
  }
  if (insights.rejected.length > 0) {
    // Compliance audit trail: what the model produced that we refused to show.
    console.warn('[compliance] rejected generated insights', JSON.stringify(insights.rejected));
  }

  // Recording is best-effort. Never let it break the response.
  if (isSupabaseConfigured()) {
    try {
      const previousEventAt = await lastEventAtForSession(sessionId);
      if (qualifiesAsReturnVisit(previousEventAt)) {
        await recordEvent({
          sessionId,
          eventType: 'returned_within_7_days',
          metadata: { previousEventAt: previousEventAt?.toISOString() },
        });
      }

      await recordEvent({
        sessionId,
        eventType: 'quiz_completed',
        metadata: {
          answers,
          score: result.score,
          band: result.band,
          breakdown: result.breakdown,
          tags: result.tags,
          insightSource: insights.source,
          // Channel → score-quality analysis: do Facebook leads score lower
          // than staffroom leads? This is where that answer comes from.
          attribution,
        },
      });
    } catch (error) {
      console.error('[events] failed to record quiz_completed', error);
    }
  }

  return NextResponse.json({
    score: result.score,
    band: result.band,
    bandLabel: result.bandLabel,
    bandSummary: result.bandSummary,
    breakdown: result.breakdown,
    tags: result.tags,
    insights: insights.insights,
    disclaimer: insights.disclaimer,
  });
}
