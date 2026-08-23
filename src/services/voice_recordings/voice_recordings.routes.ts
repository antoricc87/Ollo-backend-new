import VoiceRecordingHandler from "./controller/voice_recording.controller";
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.post(
      "/api/voicerecording/create_recording_chunk",
      VoiceRecordingHandler.createRecordingChunk
    );
  }
  routesConfig() {
    this.appRoutes();
  }
}
