import { getDb } from "@/db/client";
import { listLibrary } from "@/lib/queries";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const library = await listLibrary(getDb());
  return <Shell library={library}>{children}</Shell>;
}
