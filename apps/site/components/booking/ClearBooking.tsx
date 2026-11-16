'use client';

import { useEffect } from 'react';
import { clearSession } from '@/lib/bff';

/** After a successful payment the wizard's saved progress is no longer needed. */
export function ClearBooking() {
  useEffect(() => clearSession('hf.booking.v1'), []);
  return null;
}
