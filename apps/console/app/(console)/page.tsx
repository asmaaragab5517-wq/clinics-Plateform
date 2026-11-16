'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loading } from '@/components/common';
import { useSession } from '@/components/session';

/** Land each role on its main screen. */
export default function Home() {
  const { can, hasRole } = useSession();
  const router = useRouter();
  useEffect(() => {
    const target = hasRole('doctor')
      ? '/doctor'
      : hasRole('receptionist')
        ? '/reception'
        : hasRole('nurse')
          ? '/nurse'
          : can('report:view')
            ? '/dashboard'
            : can('bill:view')
              ? '/cashier'
              : '/profile';
    router.replace(target);
  }, [can, hasRole, router]);
  return <Loading />;
}
