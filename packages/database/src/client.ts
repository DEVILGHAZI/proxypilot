import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { proxypilotPrisma?: PrismaClient };

export function getPrisma(): PrismaClient {
  if (!globalForPrisma.proxypilotPrisma) {
    globalForPrisma.proxypilotPrisma = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });
  }
  return globalForPrisma.proxypilotPrisma;
}

export async function checkDatabase(client: PrismaClient = getPrisma()): Promise<void> {
  await client.$queryRaw`SELECT 1`;
}

export async function disconnectDatabase(): Promise<void> {
  if (globalForPrisma.proxypilotPrisma) {
    await globalForPrisma.proxypilotPrisma.$disconnect();
    globalForPrisma.proxypilotPrisma = undefined;
  }
}
