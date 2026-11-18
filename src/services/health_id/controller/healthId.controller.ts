import { Response } from "express";
import { z } from "zod";
import Util from "../../../utils/response";
import HealthIdService from "../model/healthId.model";
import { isSectionKey, MAX_SECTION_CHARS } from "../domain/healthId";
import { completeOnboarding, confirmHeard, understandWords } from "../model/understand.service";

const StoryBody = z.object({
  words: z.string().trim().min(1).max(8000),
  kind: z.enum(["onboarding", "record_again", "typed"]).default("onboarding"),
  // What the screen already shows; re-validated in code before use.
  draft: z.object({ facts: z.any().nullable().optional(), story: z.record(z.string()).nullable().optional() }).nullable().optional(),
});
const ConfirmBody = z.object({
  facts: z.record(z.any()),
  story: z.record(z.string()).default({}),
  sourceId: z.string().nullable().optional(),
});

const SectionBody = z.object({ text: z.string().max(MAX_SECTION_CHARS * 2) });

/** Patient identity always comes from the verified token — never from the body. */
class HealthIdHandler {
  async fetch(request: any, response: Response) {
    try {
      const view = await HealthIdService.get(request.user.id);
      if (!view) return response.status(404).json(Util.error({}, "Patient not found"));
      return response.status(200).json(Util.success(view, "Health ID"));
    } catch (error) {
      console.error("Error reading Health ID", error);
      return response.status(400).json(Util.error({}, "Error reading Health ID"));
    }
  }

  /** The person edits one section; empty text removes it. */
  async editSection(request: any, response: Response) {
    const key = request.params.section;
    if (!isSectionKey(key)) return response.status(400).json(Util.error({}, "Unknown section"));
    const body = SectionBody.safeParse(request.body ?? {});
    if (!body.success) return response.status(400).json(Util.error({ issues: body.error.issues }, "Invalid section"));
    try {
      await HealthIdService.edit(request.user.id, [{ key, text: body.data.text }], "person");
      return response.status(200).json(Util.success(await HealthIdService.get(request.user.id), "Health ID saved"));
    } catch (error) {
      console.error("Error saving Health ID", error);
      return response.status(400).json(Util.error({}, "Error saving Health ID"));
    }
  }

  /** Their words → a draft to check. Saves their words, nothing else. */
  async understand(request: any, response: Response) {
    const body = StoryBody.safeParse(request.body ?? {});
    if (!body.success) return response.status(400).json(Util.error({ issues: body.error.issues }, "Invalid story"));
    try {
      const out = await understandWords(request.user.id, { words: body.data.words, kind: body.data.kind, draft: body.data.draft as any });
      return response.status(200).json(Util.success(out, "Heard"));
    } catch (error) {
      console.error("Error understanding Health ID story", error);
      return response.status(502).json(Util.error({}, "Couldn't read that just now. Try again."));
    }
  }

  /** The person confirmed the draft: facts to the record, story to the Health ID. */
  async confirm(request: any, response: Response) {
    const body = ConfirmBody.safeParse(request.body ?? {});
    if (!body.success) return response.status(400).json(Util.error({ issues: body.error.issues }, "Invalid draft"));
    try {
      const out = await confirmHeard(request.user.id, body.data as any);
      return response.status(200).json(Util.success(out, "Saved"));
    } catch (error) {
      console.error("Error saving Health ID draft", error);
      return response.status(400).json(Util.error({}, "Error saving"));
    }
  }

  /** Finish onboarding — refused while a required fact is missing. */
  async complete(request: any, response: Response) {
    try {
      const out = await completeOnboarding(request.user.id);
      if ("missing" in out) return response.status(422).json(Util.error({ code: "missing_facts", missing: out.missing }, "Some details are still missing"));
      return response.status(200).json(Util.success(out, "Onboarding complete"));
    } catch (error) {
      console.error("Error completing onboarding", error);
      return response.status(400).json(Util.error({}, "Error completing onboarding"));
    }
  }

  /** Start from scratch. */
  async reset(request: any, response: Response) {
    try {
      await HealthIdService.reset(request.user.id);
      return response.status(200).json(Util.success(await HealthIdService.get(request.user.id), "Health ID cleared"));
    } catch (error) {
      console.error("Error clearing Health ID", error);
      return response.status(400).json(Util.error({}, "Error clearing Health ID"));
    }
  }
}

export default new HealthIdHandler();
