import fs from "fs";
import moment from "moment-timezone";
import { formatReplay, replay } from "./replay";
import { SignalInput } from "../domain/types";
import { synthetic } from "./synthetic";

/**
 * Replay CLI — the calibration loop.
 *
 *   npx ts-node --transpile-only src/services/signals/replay/cli.ts --demo
 *   npx ts-node --transpile-only src/services/signals/replay/cli.ts --patient <id>
 *   npx ts-node --transpile-only src/services/signals/replay/cli.ts --file series.json [--json]
 *
 * `--demo` needs no database: a planted 90-day history with a recovery dip, a
 * fortnight of drifting training and a logging gap in it, so the engine can be
 * watched end to end before any real nights have synced.
 */
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? null : process.argv[i + 1] ?? "";
};

const main = async () => {
  let input: SignalInput;

  if (process.argv.includes("--demo")) {
    input = synthetic();
  } else if (arg("file")) {
    input = JSON.parse(fs.readFileSync(arg("file") as string, "utf8"));
  } else if (arg("patient")) {
    const { collect } = await import("../model/collect");
    const prisma = (await import("../../../utility/prismaClient")).default;
    const patientId = arg("patient") as string;
    const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true } });
    const tz = patient?.timeZone || "UTC";
    input = await collect(patientId, moment().tz(tz).format("YYYY-MM-DD"), tz, Number(arg("days") ?? 365));
  } else {
    console.error("usage: cli.ts --demo | --patient <id> [--days 365] | --file <series.json>");
    process.exit(1);
    return;
  }

  const result = replay(input, { from: arg("from") ?? undefined, to: arg("to") ?? undefined });
  console.log(process.argv.includes("--json") ? JSON.stringify(result, null, 2) : formatReplay(result));
  process.exit(0);
};

void main();
