'use client';

import { useEffect } from 'react';

import { captureAttribution } from '@/lib/attribution';

/**
 * Mounted once in the root layout so every entry page records its channel.
 * Reads window.location directly (no useSearchParams) to keep pages static.
 */
export function AttributionCapture() {
  useEffect(() => {
    captureAttribution();
  }, []);
  return null;
}
