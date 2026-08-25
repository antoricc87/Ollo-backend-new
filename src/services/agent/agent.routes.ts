import { verifyToken } from "../../utils/auth_token";
import agentApi from "./controller/agent.controller";

/**
 * Ollie agent (Aug 2026 rewrite) — patient-scoped; identity from the token only.
 */
export default class Routes {
  app: any;
  constructor(app: any) {
    this.app = app;
  }

  appRoutes() {
    this.app.get("/api/agent/threads", verifyToken, agentApi.listThreads);
    this.app.post("/api/agent/threads", verifyToken, agentApi.createThread);
    this.app.get("/api/agent/threads/:threadId", verifyToken, agentApi.getThread);
    this.app.put("/api/agent/threads/:threadId", verifyToken, agentApi.renameThread);
    this.app.delete("/api/agent/threads/:threadId", verifyToken, agentApi.deleteThread);

    this.app.get("/api/agent/memories", verifyToken, agentApi.listMemories);
    this.app.post("/api/agent/memories", verifyToken, agentApi.createMemory);
    this.app.delete("/api/agent/memories/:memoryId", verifyToken, agentApi.deleteMemory);

    this.app.post("/api/agent/snapshot", verifyToken, agentApi.snapshot);
    this.app.post("/api/agent/chat", verifyToken, agentApi.chat);
    this.app.get("/api/agent/tools", verifyToken, agentApi.tools);

    this.app.get("/api/agent/proposals", verifyToken, agentApi.listProposals);
    this.app.post("/api/agent/proposals/:proposalId/confirm", verifyToken, agentApi.confirmProposal);
    this.app.post("/api/agent/proposals/:proposalId/cancel", verifyToken, agentApi.cancelProposal);

    this.app.get("/api/agent/preferences", verifyToken, agentApi.getPreferences);
    this.app.put("/api/agent/preferences", verifyToken, agentApi.updatePreferences);
    this.app.post("/api/agent/proactive/:kind", verifyToken, agentApi.runProactive);
  }

  routesConfig() {
    this.appRoutes();
  }
}
module.exports = Routes;
