/**
 * DEV UTILITY — reset the local test account's password.
 * Local development database only. Run from the backend root:
 *   node scripts/dev-reset-test-password.js <email> <new-password>
 */
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const [email, newPassword] = process.argv.slice(2);
if (!email || !newPassword) {
  console.error("Usage: node scripts/dev-reset-test-password.js <email> <new-password>");
  process.exit(1);
}

(async () => {
  const prisma = new PrismaClient();
  const patient = await prisma.patient.findFirst({ where: { email } });
  if (!patient) {
    console.error(`No patient found with email ${email}. Existing patients:`);
    const all = await prisma.patient.findMany({ select: { email: true } });
    console.error(all.map((p) => `  ${p.email}`).join("\n"));
    process.exit(1);
  }
  const hash = await bcrypt.hash(newPassword, 10);
  await prisma.patient.update({
    where: { id: patient.id },
    data: { password: hash },
  });
  console.log(`Password reset for ${email}`);
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
