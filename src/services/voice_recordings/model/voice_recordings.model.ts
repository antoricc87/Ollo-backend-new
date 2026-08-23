import prisma from "../../../utility/prismaClient";

class VoiceRecordingService {
  async createUpdateRecordingSession(
    userId: string,
    sessionIdentifier: string
  ) {
    try {
      const response = await prisma.recordingSession.upsert({
        where: { uniqueIdentifier: sessionIdentifier },
        update: { updatedAt: new Date(Date.now()) },
        create: {
          uniqueIdentifier: sessionIdentifier,
          userId: userId,
        },
      });
      return response;
    } catch (error: unknown) {
      console.error("Error creating the session", error);
      throw error;
    }
  }

  async createRecordingChunk(
    userId: string,
    chunkTranscript: string,
    sessionIdentifier: string,
    startTime: string,
    chunkIndex: number
  ) {
    try {
      const session = await this.createUpdateRecordingSession(
        userId,
        sessionIdentifier
      );
      const recordingChunk = await prisma.recordingChunk.upsert({
        where: { sessionId: session.id, startTime: startTime },
        update: {
          transcript: chunkTranscript,
        },
        create: {
          chunkIndex: chunkIndex,
          startTime: startTime,
          sessionId: session.id,
          transcript: chunkTranscript,
        },
      });
      if (recordingChunk) return recordingChunk;
    } catch (error: unknown) {
      console.error("Error creating the chunk", error);
      throw error;
    }
  }
}
export default new VoiceRecordingService();
