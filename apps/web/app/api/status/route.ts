import { loadSystemStatus } from "@/lib/status";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await loadSystemStatus();
  return Response.json(status);
}
