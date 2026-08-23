import { Response } from "express";
import Util from "../../../utils/response";
import { ObjectId } from "../../../utils/idValidation";
import {
  callFitnessAgent,
  callGeneralAgent,
  callHealthAgent,
  callNutritionAgent,
} from "../model/ai_agent.model";
import { speechToText } from "../../openAI/model/openai.model";

class AIAgentHandler {
  async callNutritionAgent(request: any, response: Response) {
    const { query, threadId, patientId } = request.body;
    console.log(query);
    if (!patientId || !ObjectId.isValid(patientId))
      return response
        .status(400)
        .json(
          Util.error({}, "Patient id is required and must be a valid object id")
        );
    if (!query)
      return response
        .status(400)
        .json(
          Util.error({}, "Please use a query to tell the AI agent what to do")
        );
    try {
      const ai_agent_response = await callNutritionAgent(
        query,
        threadId,
        patientId
      );
      if (ai_agent_response)
        return response
          .status(200)
          .json(
            Util.success(ai_agent_response, "Response successfully generated")
          );
    } catch (error: unknown) {
      return response.status(403);
    }
  }
  async callFitnessAgent(request: any, response: Response) {
    const { query, threadId, patientId } = request.body;
    if (!patientId || !ObjectId.isValid(patientId))
      return response
        .status(400)
        .json(
          Util.error({}, "Patient id is required and must be a valid object id")
        );
    if (!query)
      return response
        .status(400)
        .json(
          Util.error({}, "Please use a query to tell the AI agent what to do")
        );
    try {
      const ai_agent_response = await callFitnessAgent(
        query,
        threadId,
        patientId
      );
      if (ai_agent_response)
        return response
          .status(200)
          .json(
            Util.success(ai_agent_response, "Response successfully generated")
          );
    } catch (error: unknown) {
      return response.status(403);
    }
  }
  async callHealthAgent(request: any, response: Response) {
    const { query, threadId, patientId } = request.body;
    if (!patientId || !ObjectId.isValid(patientId))
      return response
        .status(400)
        .json(
          Util.error({}, "Patient id is required and must be a valid object id")
        );
    if (!query)
      return response
        .status(400)
        .json(
          Util.error({}, "Please use a query to tell the AI agent what to do")
        );
    try {
      const ai_agent_response = await callHealthAgent(
        query,
        threadId,
        patientId
      );

      if (ai_agent_response)
        return response
          .status(200)
          .json(
            Util.success(ai_agent_response, "Response successfully generated")
          );
    } catch (error: unknown) {
      return response.status(403);
    }
  }
  async callGeneralAgent(request: any, response: Response) {
    const { query, threadId, patientId, isAudio } = request.body;
    if (!patientId || !ObjectId.isValid(patientId))
      return response
        .status(400)
        .json(
          Util.error({}, "Patient id is required and must be a valid object id")
        );
    if (!query)
      return response
        .status(400)
        .json(
          Util.error({}, "Please use a query to tell the AI agent what to do")
        );
    try {
      let processedQuery = query;
      if (isAudio) processedQuery = await speechToText(query);
      console.log(processedQuery);
      const ai_agent_response = await callGeneralAgent(
        processedQuery,
        threadId,
        patientId
      );
      if (ai_agent_response)
        return response
          .status(200)
          .json(
            Util.success(ai_agent_response, "Response successfully generated")
          );
    } catch (error: unknown) {
      return response.status(403);
    }
  }

  // streaming
  // async callGeneralAgent(request: any, response: Response) {
  //   const { query, threadId, patientId, isAudio } = request.body;

  //   // Validate inputs
  //   if (!patientId || !ObjectId.isValid(patientId)) {
  //     return response
  //       .status(400)
  //       .json(
  //         Util.error({}, "Patient id is required and must be a valid object id")
  //       );
  //   }
  //   if (!query) {
  //     return response
  //       .status(400)
  //       .json(
  //         Util.error({}, "Please use a query to tell the AI agent what to do")
  //       );
  //   }

  //   try {
  //     // Set up SSE headers
  //     response.setHeader("Content-Type", "text/event-stream");
  //     response.setHeader("Cache-Control", "no-cache");
  //     response.setHeader("Connection", "keep-alive");
  //     response.flushHeaders();

  //     let processedQuery = query;
  //     if (isAudio) {
  //       processedQuery = await speechToText(query);
  //     }

  //     // Create a streaming handler
  //     const onStream = (chunk: string) => {
  //       response.write(`data: ${JSON.stringify({ chunk })}\n\n`);
  //     };

  //     // Call the agent with streaming
  //     const ai_agent_response = await callGeneralAgent(
  //       processedQuery,
  //       threadId,
  //       patientId,
  //       onStream
  //     );

  //     // Send the final response
  //     response.write(
  //       `data: ${JSON.stringify({ done: true, ...ai_agent_response })}\n\n`
  //     );
  //     response.end();
  //   } catch (error: unknown) {
  //     console.error("Error in streaming response:", error);
  //     if (!response.headersSent) {
  //       return response
  //         .status(403)
  //         .json(
  //           Util.error({}, "An error occurred while processing your request")
  //         );
  //     } else {
  //       response.write(
  //         `data: ${JSON.stringify({
  //           error: "An error occurred while processing your request",
  //         })}\n\n`
  //       );
  //       response.end();
  //     }
  //   }
  // }
}
export default new AIAgentHandler();
