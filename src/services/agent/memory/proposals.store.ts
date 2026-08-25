import { Prisma } from "@prisma/client";
import prisma from "../../../utility/prismaClient";
import { audit } from "./audit";
import threadStore from "./thread.store";
import { dayKey, safeTz } from "./dates";
import { registry } from "../tools";
import { Proposal, ToolContext, validateInput } from "../tools/registry";
import { makeSubjectResolver } from "../tools/subject";

/**
 * Confirm-gated writes. The agent loop stores a proposal; the app shows it as
 * a card; the user confirms (optionally with edits) or cancels. Commit runs
 * the tool's `commit` with the same service code the app's own screens use,
 * then tells the thread what happened so the next turn knows.
 */

export const PROPOSAL_TTL_HOURS = 24;

const json = (v: unknown) => v as Prisma.InputJsonValue;

class ProposalStore {
  async create(patientId: string, threadId: string | null, toolName: string, input: unknown, proposal: Proposal) {
    return prisma.agentProposal.create({
      data: {
        patientId,
        threadId,
        toolName,
        title: proposal.title,
        summary: proposal.summary,
        input: json(input),
        preview: json(proposal.preview),
        expiresAt: new Date(Date.now() + PROPOSAL_TTL_HOURS * 3600 * 1000),
      },
    });
  }

  async get(patientId: string, proposalId: string) {
    return prisma.agentProposal.findFirst({ where: { id: proposalId, patientId } });
  }

  async list(patientId: string, opts: { status?: "PENDING" | "CONFIRMED" | "CANCELLED" | "EXPIRED" | "FAILED"; threadId?: string; limit?: number } = {}) {
    await this.expireStale(patientId);
    return prisma.agentProposal.findMany({
      where: { patientId, ...(opts.status ? { status: opts.status } : {}), ...(opts.threadId ? { threadId: opts.threadId } : {}) },
      orderBy: { createdAt: "desc" },
      take: opts.limit ?? 20,
    });
  }

  private async expireStale(patientId: string) {
    await prisma.agentProposal.updateMany({
      where: { patientId, status: "PENDING", expiresAt: { lt: new Date() } },
      data: { status: "EXPIRED" },
    });
  }

  /**
   * Commit a pending proposal. `edits` (optional) are merged over the stored
   * input and re-validated against the tool schema, so the user can correct
   * a meal type, a value or a date from the card before confirming.
   * `previewEdits` (optional) adjust the preview itself — portions on a meal —
   * via the tool's `applyPreviewEdits`; tools without it ignore them.
   */
  async confirm(patientId: string, proposalId: string, edits?: Record<string, unknown> | null, previewEdits?: unknown) {
    const p = await this.get(patientId, proposalId);
    if (!p) return { status: 404 as const, error: "Proposal not found" };
    if (p.status !== "PENDING") return { status: 409 as const, error: `Proposal is ${p.status.toLowerCase()}` };
    if (p.expiresAt < new Date()) {
      await prisma.agentProposal.update({ where: { id: p.id }, data: { status: "EXPIRED" } });
      return { status: 410 as const, error: "Proposal expired — ask Ollie again" };
    }
    const tool = registry.get(p.toolName);
    if (!tool || !tool.commit) return { status: 500 as const, error: `Tool ${p.toolName} cannot be committed` };

    const merged = edits && typeof edits === "object" ? { ...(p.input as object), ...edits } : (p.input as object);
    const parsed = validateInput(tool, merged);
    if (!parsed.success) {
      const error = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
      return { status: 400 as const, error: `Invalid edits — ${error}` };
    }

    const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { timeZone: true } });
    const tz = safeTz(patient?.timeZone);
    const ctx: ToolContext = { patientId, threadId: p.threadId, timeZone: tz, today: dayKey(tz), resolveSubject: makeSubjectResolver(patientId) };

    void audit(patientId, "tool_commit", { threadId: p.threadId, toolName: p.toolName, payload: { proposalId: p.id, edited: !!edits, previewEdited: !!previewEdits } });
    try {
      // Input edits invalidate the stored preview (the tool re-derives it);
      // preview edits (e.g. portion changes) are handed to the tool as-is.
      const preview = edits ? null : previewEdits ? tool.applyPreviewEdits?.(p.preview, previewEdits) ?? p.preview : p.preview;
      const out = await tool.commit(ctx, parsed.data, preview);
      const done = await prisma.agentProposal.update({
        where: { id: p.id },
        data: { status: "CONFIRMED", confirmedAt: new Date(), result: json(out.result ?? null), input: json(parsed.data) },
      });
      if (p.threadId)
        await threadStore.append(p.threadId, [
          { role: "SYSTEM", content: `[User confirmed "${p.title}" — ${p.toolName} result: ${JSON.stringify(out.result).slice(0, 600)}]`, meta: { proposalId: p.id } },
        ]);
      return { status: 200 as const, proposal: done, result: out.result, cards: out.cards ?? [] };
    } catch (e: any) {
      const error = e?.message ?? String(e);
      console.error(`agent commit ${p.toolName} failed`, e);
      await prisma.agentProposal.update({ where: { id: p.id }, data: { status: "FAILED", result: json({ error }) } });
      void audit(patientId, "error", { threadId: p.threadId, toolName: p.toolName, payload: { proposalId: p.id, stage: "commit", error } });
      return { status: 500 as const, error: `Could not complete: ${error}` };
    }
  }

  async cancel(patientId: string, proposalId: string) {
    const p = await this.get(patientId, proposalId);
    if (!p) return { status: 404 as const, error: "Proposal not found" };
    if (p.status !== "PENDING") return { status: 409 as const, error: `Proposal is ${p.status.toLowerCase()}` };
    const done = await prisma.agentProposal.update({ where: { id: p.id }, data: { status: "CANCELLED" } });
    if (p.threadId) await threadStore.append(p.threadId, [{ role: "SYSTEM", content: `[User declined "${p.title}" (${p.toolName})]`, meta: { proposalId: p.id } }]);
    return { status: 200 as const, proposal: done };
  }
}

export default new ProposalStore();
