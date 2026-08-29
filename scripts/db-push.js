/**
 * Boot-time schema sync (Railway has no migrations dir).
 * `prisma db push` refuses destructive changes so a deploy can never drop data
 * by accident. When a release DOES need a destructive change (e.g. the
 * 2026-08-29 physician-surface removal), set PRISMA_ACCEPT_DATA_LOSS=true on
 * the service for ONE deploy, then remove it again.
 */
const { spawnSync } = require("child_process");

const args = ["prisma", "db", "push", "--skip-generate"];
if (process.env.PRISMA_ACCEPT_DATA_LOSS === "true") {
  console.warn("db-push: PRISMA_ACCEPT_DATA_LOSS=true — destructive schema changes WILL be applied");
  args.push("--accept-data-loss");
}
const r = spawnSync("npx", args, { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status === null ? 1 : r.status);
