/**
 * Print a saved Ollie thread as a readable transcript with its trace: each
 * user message, the tools called (input + result), cards, safety verdict,
 * model/usage and the reply. Reads the DB only — never calls the model.
 *
 *   npm run agent:transcript                    latest thread (any account)
 *   npm run agent:transcript -- --list [N]      the N most recent threads
 *   npm run agent:transcript -- <threadId>      one thread (id prefix is enough)
 *   npm run agent:transcript -- --email a@b.c   latest thread of that account
 *   npm run agent:transcript -- --last 3        only the last 3 turns
 *   npm run agent:transcript -- --full          do not shorten tool results / cards
 *   npm run agent:transcript -- --json          raw rows
 *   npm run agent:transcript -- --railway …     the same, read from the PRODUCTION backend over its API
 *                                               (your account there has the same id and JWT secret; audit rows unavailable)
 */
import "dotenv/config";
import jwt from "jsonwebtoken";
import prisma from "../src/utility/prismaClient";

const RAILWAY = process.env.RAILWAY_API_BASE ?? "https://ollo-backend-new-production.up.railway.app/api";

const args = process.argv.slice(2);
const flag = (k: string) => args.includes(k);
const arg = (k: string) => {
  const v = args.indexOf(k) >= 0 ? args[args.indexOf(k) + 1] : undefined;
  return v && !v.startsWith("--") ? v : undefined;
};
const FULL = flag("--full");
const REMOTE = flag("--railway");
const RESULT_CAP = 900;
const CARD_CAP = 500;

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const indent = (s: string, pad = "    ") => s.split("\n").map((l) => pad + l).join("\n");
const cut = (s: string, cap: number) =>
  FULL || s.length <= cap ? s : `${s.slice(0, cap)}… ${dim(`(+${s.length - cap} chars, --full to see)`)}`;
const time = (d: Date) => d.toISOString().replace("T", " ").slice(0, 19);

/** Tool results are stored as JSON strings; show them compact but parsed. */
function pretty(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content));
  } catch {
    return content;
  }
}

/** A short-lived token for the local account's id — Railway accepts it because the secret and the id are shared. */
const remoteToken = async (email: string) => {
  const p = await prisma.patient.findUnique({ where: { email }, select: { id: true } });
  if (!p) throw new Error(`no local patient ${email} (the token is signed for the local account's id)`);
  return jwt.sign({ user: { id: p.id } }, process.env.JWT_SECRET as string, { expiresIn: "10m" });
};

const remote = async (path: string, email: string) => {
  const r = await fetch(`${RAILWAY}${path}`, { headers: { "access-token": await remoteToken(email) } });
  if (!r.ok) throw new Error(`Railway ${path}: ${r.status}`);
  const body: any = await r.json();
  return body.result ?? body;
};

async function listRemote(email: string, limit: number) {
  const data = await remote(`/agent/threads?limit=${limit}`, email);
  const threads: any[] = data.threads ?? data;
  for (const t of threads) console.log(`${t.id.slice(0, 8)}  ${t.lastMessageAt ? time(new Date(t.lastMessageAt)) : "—".padEnd(19)}  ${String(t.source).padEnd(9)}  ${email}  ${t.title ?? ""}`);
}

async function loadRemote(idPrefix: string | undefined, email: string) {
  let id = idPrefix;
  if (!id || id.length < 36) {
    const data = await remote(`/agent/threads?limit=50`, email);
    const threads: any[] = data.threads ?? data;
    const hit = id ? threads.filter((t) => t.id.startsWith(id!)) : threads.filter((t) => t.lastMessageAt).slice(0, 1);
    if (hit.length !== 1) throw new Error(hit.length ? `"${id}" matches more than one thread` : `no thread ${id ?? ""}`);
    id = hit[0].id;
  }
  const t: any = await remote(`/agent/threads/${id}?tools=true`, email);
  const thread = t.thread ?? t;
  const rows = (thread.messages ?? t.messages ?? []).map((r: any) => ({ ...r, createdAt: new Date(r.createdAt) }));
  return { thread, rows, audits: [] as any[], email };
}

async function list(email?: string, limit = 15) {
  const threads = await prisma.agentThread.findMany({
    where: email ? { patient: { email } } : {},
    orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: limit,
    include: { patient: { select: { email: true } }, _count: { select: { messages: true } } },
  });
  for (const t of threads) {
    console.log(
      `${t.id.slice(0, 8)}  ${t.lastMessageAt ? time(t.lastMessageAt) : "—".padEnd(19)}  ${t.source.padEnd(9)} ${String(t._count.messages).padStart(3)} rows  ${t.patient.email}  ${t.title ?? ""}`
    );
  }
}

async function resolveThread(idPrefix?: string, email?: string) {
  if (idPrefix) {
    const hits = await prisma.agentThread.findMany({ where: { id: { startsWith: idPrefix } }, take: 2 });
    if (hits.length !== 1) throw new Error(hits.length ? `"${idPrefix}" matches more than one thread` : `no thread ${idPrefix}`);
    return hits[0];
  }
  const latest = await prisma.agentThread.findFirst({
    where: { lastMessageAt: { not: null }, ...(email ? { patient: { email } } : {}) },
    orderBy: { lastMessageAt: "desc" },
  });
  if (!latest) throw new Error("no threads found");
  return latest;
}

async function loadLocal(idPrefix: string | undefined, email: string | undefined) {
  const thread = await resolveThread(idPrefix, email);
  const [patient, rows, audits] = await Promise.all([
    prisma.patient.findUnique({ where: { id: thread.patientId }, select: { email: true } }),
    prisma.agentMessage.findMany({ where: { threadId: thread.id }, orderBy: { seq: "asc" } }),
    prisma.agentAuditLog.findMany({ where: { threadId: thread.id }, orderBy: { createdAt: "asc" } }),
  ]);
  return { thread, rows, audits, email: patient?.email ?? "?" };
}

async function main() {
  const email = arg("--email") ?? (REMOTE ? "antoricciardelli@gmail.com" : undefined);
  const idPrefix = args.find((a, i) => !a.startsWith("--") && !["--email", "--last", "--list"].includes(args[i - 1]));
  if (flag("--list")) return REMOTE ? listRemote(email!, Number(arg("--list")) || 15) : list(email, Number(arg("--list")) || 15);

  const loaded = REMOTE ? await loadRemote(idPrefix, email!) : await loadLocal(idPrefix, email);
  const { thread, rows, audits } = loaded;
  const patient = { email: loaded.email };
  if (flag("--json")) return console.log(JSON.stringify({ thread, rows, audits }, null, 2));

  // A turn = one USER row and everything up to the next one.
  const turns: any[][] = [];
  for (const r of rows) {
    if (r.role === "USER" || turns.length === 0) turns.push([]);
    turns[turns.length - 1].push(r);
  }
  const last = Number(arg("--last")) || turns.length;
  const shown = turns.slice(-last);

  console.log(bold(`Thread ${thread.id}`));
  console.log(`${patient?.email} · ${thread.source} · ${rows.length} rows · ${turns.length} turns · ${thread.title ?? "untitled"}`);
  if (thread.summary) console.log(dim(`summary (up to seq ${thread.summarizedUpTo}): ${cut(thread.summary, 400)}`));

  const results = new Map(rows.filter((r) => r.role === "TOOL" && r.toolCallId).map((r) => [r.toolCallId!, r]));
  for (const [i, turn] of shown.entries()) {
    const n = turns.length - shown.length + i + 1;
    const start = turn[0].createdAt;
    const end = turn[turn.length - 1].createdAt;
    console.log(`\n${bold(`── Turn ${n}`)} ${dim(`${time(start)} · ${((end.getTime() - start.getTime()) / 1000).toFixed(1)} s`)}`);
    for (const r of turn) {
      if (r.role === "USER") console.log(`${bold("YOU")}  ${r.content}`);
      if (r.role === "SYSTEM") console.log(dim(`SYSTEM  ${cut(r.content, RESULT_CAP)}`));
      if (r.role !== "ASSISTANT") continue;

      const calls = (r.toolCalls as { id: string; name: string; input: unknown }[] | null) ?? [];
      for (const c of calls) {
        console.log(`  → ${bold(c.name)}(${JSON.stringify(c.input)})`);
        const res = results.get(c.id);
        console.log(res ? indent(dim("← ") + cut(pretty(res.content), RESULT_CAP)) : indent(red("← no result saved")));
      }
      // Text saved next to tool calls is the model thinking aloud between steps.
      if (r.content.trim()) console.log(calls.length ? indent(dim(`(said) ${r.content}`), "  ") : `${bold("OLLIE")}\n${indent(r.content, "  ")}`);

      const cards = (r.cards as { type?: string }[] | null) ?? [];
      for (const c of cards) console.log(`  ▣ ${bold(`card:${c.type}`)} ${dim(cut(JSON.stringify(c), CARD_CAP))}`);

      const meta = r.meta as Record<string, any> | null;
      if (meta && !calls.length) {
        const s = meta.safety;
        const flagged = s?.flagged?.length ? ` flagged ${[].concat(s.flagged).join(",")}` : "";
        const usage = meta.usage ? `${meta.usage.inputTokens ?? "?"} in / ${meta.usage.outputTokens ?? "?"} out` : "";
        const line = [meta.model, usage, meta.latencyMs ? `${meta.latencyMs} ms` : "", s ? `safety ${s.outcome ?? JSON.stringify(s)}${flagged}` : ""].filter(Boolean).join(" · ");
        const bad = s?.outcome && !["pass", "clean", "ok"].includes(String(s.outcome).toLowerCase());
        if (line) console.log("  " + (bad ? red(line) : dim(line)));
        const rest = Object.keys(meta).filter((k) => !["model", "usage", "latencyMs", "safety"].includes(k));
        if (rest.length && FULL) console.log(dim(`  meta: ${JSON.stringify(Object.fromEntries(rest.map((k) => [k, meta[k]])))}`));
      }
    }
    // Audit rows that carry something the message rows do not.
    const extra = audits.filter(
      (a) => a.createdAt >= start && (i === shown.length - 1 || a.createdAt < shown[i + 1][0].createdAt) && ["safety_flag", "red_flag", "error", "tool_commit"].includes(a.event)
    );
    for (const a of extra) console.log(`  ${a.event === "tool_commit" ? dim("✔") : red("⚑")} ${a.event}${a.toolName ? ` ${a.toolName}` : ""} ${dim(cut(JSON.stringify(a.payload), CARD_CAP))}`);
  }
}

main()
  .catch((e) => {
    console.error(e?.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
