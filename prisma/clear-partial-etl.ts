// One-off cleanup: the ETL script (migrate-from-json.ts) failed partway
// through on an earlier run, leaving reference/org tables populated but no
// findings or anything downstream of them. This clears every table the ETL
// writes to, in reverse dependency order, so migrate-from-json.ts can be
// re-run from a clean slate without duplicate-key errors.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.auditLogEntry.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.comment.deleteMany();
  await prisma.evidence.deleteMany();
  await prisma.findingClosure.deleteMany();
  await prisma.findingTransfer.deleteMany();
  await prisma.findingCase.deleteMany();
  await prisma.rectificationEntry.deleteMany();
  await prisma.findingTransition.deleteMany();
  await prisma.finding.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.scoringAdjustment.deleteMany();
  await prisma.reportingPeriod.deleteMany();
  await prisma.scoringRule.deleteMany();
  await prisma.user.deleteMany();
  await prisma.uncoveredReason.deleteMany();
  await prisma.classifiedCategory.deleteMany();
  await prisma.department.deleteMany();
  await prisma.source.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.district.deleteMany();
  await prisma.roleDefinition.deleteMany();
  await prisma.branchCoverageNote.deleteMany();
  await prisma.settings.deleteMany();
  console.log("Cleared all tables.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
