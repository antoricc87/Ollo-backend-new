import { Request, Response } from "express";
import Util from "../../../utils/response";
import VoiceRecordingService from "../model/voice_recordings.model";
class VoiceRecodingsHandler {
  async createRecordingChunk(request: Request, response: Response) {
    const {
      userId,
      chunkTranscript,
      sessionIdentifier,
      startTime,
      chunkIndex,
    } = request.body;
    console.log("called");
    try {
      console.log(userId);
      console.log(chunkIndex);
      console.log(chunkTranscript);
      console.log(sessionIdentifier);
      console.log(startTime);

      if (
        !userId ||
        chunkIndex === undefined ||
        chunkIndex === null ||
        !chunkTranscript ||
        !sessionIdentifier ||
        !startTime
      ) {
        return response
          .status(500)
          .json(Util.error({}, "Missing mandatory parameters"));
      }
      const recordingChunk = await VoiceRecordingService.createRecordingChunk(
        userId,
        chunkTranscript,
        sessionIdentifier,
        startTime,
        chunkIndex
      );
      if (recordingChunk) {
        return response
          .status(201)
          .json(Util.success(recordingChunk, "Chunk recorded successfully"));
      }
    } catch (error: unknown) {
      return response
        .status(500)
        .json(Util.error({ error }, "Error creating the chunk"));
    }
  }
}

export default new VoiceRecodingsHandler();
