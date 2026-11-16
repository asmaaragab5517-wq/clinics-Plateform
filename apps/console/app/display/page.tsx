import { DisplayScreen } from './display-screen';

export const dynamic = 'force-dynamic';

/** Waiting-room screen (FR-APT-6): opened with a clinic display token; no staff session needed. */
export default async function DisplayPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <DisplayScreen token={token ?? ''} />;
}
