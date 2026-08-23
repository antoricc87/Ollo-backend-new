import { Request, Response } from "express";
import Util from "../../../utils/response";
import BFPService from "../model/bfp.model";
import { ObjectId } from "../../../utils/idValidation";

class BFPHandler {
  //create bfp entry
  async createBFPEntry(request: any, response: Response) {
    const { id } = request.user;
    const { bfp } = request.body;
    if (!bfp)
      return response
        .status(400)
        .json(Util.error({}, "Body fat percentage is required"));
    try {
      const BFPEntry = await BFPService.createBFPEntry(id, bfp);
      if (BFPEntry)
        return response
          .status(200)
          .json(Util.success(BFPEntry, "BFP entry created successfully"));
    } catch (error: unknown) {
      console.error("Something went wrong creating the BFP entry", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error creating the wBFP entry"));
    }
  }
  // delete bfp entry
  async deleteBFPEntry(request: any, response: Response) {
    const { entryId } = request.body;
    if (!entryId || !ObjectId.isValid(entryId))
      return response
        .status(400)
        .json(
          Util.error({}, "Entry id is required and must be a valid ObjectId")
        );
    try {
      const deletedBFPEntry = await BFPService.deleteBFPEntry(entryId);
      if (deletedBFPEntry)
        return response
          .status(200)
          .json(
            Util.success(deletedBFPEntry, "BFP entry deleted successfully")
          );
    } catch (error: unknown) {
      console.error("Something went wrong deleting the bfp entry", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error deleting the weight entry"));
    }
  }
  // fetch bfp tracker
  async fetchBFPTracker(request: any, response: Response) {
    const { id } = request.user;
    const patientId = request.body.patientId ? request.body.patientId : id;
    try {
      const bfpTracker = await BFPService.getBFPTracker(patientId);
      if (bfpTracker)
        return response
          .status(200)
          .json(Util.success(bfpTracker, "BFP tracker successfully fetched"));
    } catch (error: unknown) {
      console.error("Error fetching the tracker", error);
      return response
        .status(400)
        .json(Util.error({ error }, "Error fetching the tracker"));
    }
  }
}

export default new BFPHandler();
