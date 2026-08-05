import { describe, expect, it } from 'vitest';

import { screenText } from '@/lib/compliance';
import {
  allScriptStrings,
  OUTBOUND_MESSAGES,
  SCRIPT_OPENING,
  TALKING_POINTS,
} from '@/lib/call-scripts';

describe('every call-centre string passes FAIS screening', () => {
  // The same property insight-templates.ts has: the scripts the agents read
  // and the messages they send can never be edited into something that names
  // a product, promises a return, or gives personal advice — the build fails.
  it.each(allScriptStrings().map((s) => [s.slice(0, 60), s] as const))(
    'screens clean: %s…',
    (_label, text) => {
      const result = screenText(text);
      expect(result.violations).toEqual([]);
      expect(result.ok).toBe(true);
    },
  );
});

describe('structure', () => {
  it('opens with the FSP disclosure and the opt-out offer before anything else', () => {
    const opening = SCRIPT_OPENING.join(' ');
    expect(opening).toMatch(/authorised financial services provider/i);
    expect(opening).toMatch(/FSP number/i);
    expect(opening).toMatch(/not call again|rather we did not call/i);
  });

  it('keeps [CONFIRM] placeholders for the compliance officer', () => {
    expect(SCRIPT_OPENING.some((l) => l.includes('[CONFIRM'))).toBe(true);
  });

  it('talking points describe how things work, never what to do', () => {
    for (const point of TALKING_POINTS.life_cover_gap) {
      expect(point).not.toMatch(/you should|we recommend|you must|you need to/i);
    }
  });

  it('every outbound message carries an opt-out line', () => {
    const url = 'https://example.test/quiz';
    expect(OUTBOUND_MESSAGES.whatsappQuizInvite(url)).toMatch(/stop/i);
    expect(OUTBOUND_MESSAGES.smsQuizInvite(url)).toMatch(/stop/i);
  });

  it('outbound messages include the link they promise', () => {
    const url = 'https://example.test/quiz?ref=agent-abc';
    expect(OUTBOUND_MESSAGES.whatsappQuizInvite(url)).toContain(url);
    expect(OUTBOUND_MESSAGES.smsQuizInvite(url)).toContain(url);
  });
});
