import { decryptString, getPrisma } from "@proxypilot/database";
import { visitThroughProxy } from "./visit.js";

function proxyServer(protocol: string, host: string, port: number): string {
  if (protocol === "SOCKS5") {
    return `socks5://${host}:${port}`;
  }
  return `http://${host}:${port}`;
}

export async function performSiteCheck(checkId: string, encryptionKey: Buffer): Promise<void> {
  const prisma = getPrisma();
  const check = await prisma.siteCheck.findUnique({
    where: { id: checkId },
    include: { proxy: true, run: true },
  });
  if (!check || check.status === "PASSED" || check.status === "FAILED") {
    return;
  }
  await prisma.siteCheck.update({
    where: { id: check.id },
    data: { status: "RUNNING" },
  });
  await prisma.siteCheckRun.update({
    where: { id: check.runId },
    data: { status: "RUNNING" },
  });

  const username = check.proxy.usernameEncrypted ? decryptString(check.proxy.usernameEncrypted, encryptionKey) : undefined;
  const password = check.proxy.passwordEncrypted ? decryptString(check.proxy.passwordEncrypted, encryptionKey) : undefined;
  const layout = check.layout === "phone" ? "phone" : "chrome";
  const outcome = await visitThroughProxy({
    url: check.run.url,
    proxyServer: proxyServer(check.proxy.protocol, check.proxy.host, check.proxy.port),
    username,
    password,
    layout,
  });

  await prisma.siteCheck.update({
    where: { id: check.id },
    data: {
      status: outcome.ok ? "PASSED" : "FAILED",
      title: outcome.title,
      scrolled: outcome.scrolled,
      latencyMs: outcome.latencyMs,
      errorCode: outcome.errorCode,
      completedAt: new Date(),
    },
  });
  await finishRun(check.runId);
}

async function finishRun(runId: string): Promise<void> {
  const prisma = getPrisma();
  const remaining = await prisma.siteCheck.count({
    where: { runId, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (remaining > 0) {
    return;
  }
  const rows = await prisma.siteCheck.findMany({ where: { runId }, select: { status: true } });
  const passed = rows.filter((row) => row.status === "PASSED").length;
  const failed = rows.length - passed;
  await prisma.siteCheckRun.update({
    where: { id: runId },
    data: {
      status: failed === 0 ? "PASSED" : "FAILED",
      passed,
      failed,
      completedAt: new Date(),
    },
  });
}
