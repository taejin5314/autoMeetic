import Anthropic from "@anthropic-ai/sdk";
import type { EditOperation, ViewportCommand, WhiteboardElement, WhiteboardSession } from "./types";
import { formatLineNumberedWhiteboard, applyWhiteboardEditOperations } from "./tools";
import { normalizeWhiteboardElements, appendLayoutWarnings } from "./elements";
import { whiteboardSystemPrompt } from "./prompt";

/**
 * Message for building agent context.
 */
interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Tool call from the model.
 */
interface ToolCall {
  name: "whiteboard_apply" | "whiteboard_overwrite";
  input: {
    operations?: EditOperation[];
    viewport?: ViewportCommand;
    elements?: WhiteboardElement[];
  };
}

/**
 * Run whiteboard agent to process a transcript chunk.
 * From autopreso: runWhiteboardAgent()
 */
export async function runWhiteboardAgent({
  transcript,
  session,
  agentInstructions,
  apiKey,
  onEvent,
}: {
  transcript: string;
  session: WhiteboardSession;
  agentInstructions?: string;
  apiKey: string;
  onEvent?: (event: any) => void;
}): Promise<void> {
  if (!transcript || transcript.trim().length === 0) return;

  try {
    session.agentBusy = true;
    session.agentStatus = "thinking";
    onEvent?.({ type: "agent:thinking", timestamp: new Date().toISOString() });

    const client = new Anthropic({
      apiKey,
    });

    // Build system prompt
    const baseSystem = whiteboardSystemPrompt();
    const system = agentInstructions ? `${baseSystem}\n\nUser instructions: ${agentInstructions}` : baseSystem;

    // Build message history
    const messages: AgentMessage[] = buildAgentMessages(session, transcript);

    // Call model with tools
    const response = await client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      system,
      messages: messages as Anthropic.MessageParam[],
      tools: [
        {
          name: "whiteboard_apply",
          description:
            "Apply edits and/or move the viewport. Combine everything into one call - do not split into back-to-back calls.",
          input_schema: {
            type: "object" as const,
            properties: {
              operations: {
                type: "array",
                description: "Edit operations applied in order",
                items: {
                  type: "object" as const,
                  oneOf: [
                    {
                      type: "object" as const,
                      properties: {
                        type: { type: "string" as const, enum: ["replace"] },
                        line: { type: "number" as const },
                        element: { type: "object" as const },
                      },
                    },
                    {
                      type: "object" as const,
                      properties: {
                        type: { type: "string" as const, enum: ["insert_after"] },
                        line: { type: "number" as const },
                        element: { type: "object" as const },
                      },
                    },
                    {
                      type: "object" as const,
                      properties: {
                        type: { type: "string" as const, enum: ["delete"] },
                        line: { type: "number" as const },
                      },
                    },
                  ],
                },
              },
              viewport: {
                type: "object" as const,
                description: "Viewport command applied AFTER edits",
                properties: {
                  action: {
                    type: "string" as const,
                    enum: ["scroll_to_content", "set_zoom", "zoom_in", "zoom_out", "reset_zoom"],
                  },
                  zoom: { type: "number" as const, minimum: 0.1, maximum: 3 },
                  focus_ids: { type: "array" as const, items: { type: "string" as const } },
                },
              },
            },
          },
        },
        {
          name: "whiteboard_overwrite",
          description: "Replace entire whiteboard. Use only for clearing/resetting.",
          input_schema: {
            type: "object" as const,
            properties: {
              elements: {
                type: "array",
                description: "Complete replacement element array",
                items: { type: "object" as const },
              },
            },
          },
        },
      ],
    });

    // Process tool uses
    for (const block of response.content) {
      if (block.type === "tool_use") {
        const toolCall = block as any as ToolCall;

        onEvent?.({
          type: "tool:start",
          tool: toolCall.name,
          input: toolCall.input,
          timestamp: new Date().toISOString(),
        });

        let result = "";
        const nextElements = applyToolCall(session, toolCall);

        result = appendLayoutWarnings(
          formatLineNumberedWhiteboard(nextElements),
          nextElements
        );

        onEvent?.({
          type: "tool:end",
          tool: toolCall.name,
          result,
          elements: nextElements,
          timestamp: new Date().toISOString(),
        });
      }
    }

    session.agentStatus = "done";
    onEvent?.({ type: "agent:done", timestamp: new Date().toISOString() });
  } finally {
    session.agentBusy = false;
  }
}

function buildAgentMessages(session: WhiteboardSession, transcript: string): AgentMessage[] {
  const messages: AgentMessage[] = [];

  // Add history if available
  for (const msg of session.agentHistory) {
    messages.push({ role: msg.role as "user" | "assistant", content: msg.content });
  }

  // Add current transcript
  const currentCanvasText = formatLineNumberedWhiteboard(session.elements);
  const userMessage = `Current canvas:\n${currentCanvasText}\n\nTranscript: ${transcript}`;

  messages.push({
    role: "user",
    content: userMessage,
  });

  return messages;
}

function applyToolCall(session: WhiteboardSession, toolCall: ToolCall): WhiteboardElement[] {
  if (toolCall.name === "whiteboard_overwrite") {
    const elements = toolCall.input.elements || [];
    const normalized = normalizeWhiteboardElements(elements);
    session.elements = normalized;
    return normalized;
  }

  if (toolCall.name === "whiteboard_apply") {
    const { operations, viewport } = toolCall.input;

    // Apply edits
    if (Array.isArray(operations) && operations.length > 0) {
      const nextElements = applyWhiteboardEditOperations(session.elements, operations);
      session.elements = normalizeWhiteboardElements(nextElements);
    }

    // Handle viewport (just acknowledge it for now)
    if (viewport) {
      // In a real implementation, you'd broadcast this to the frontend
    }

    return session.elements;
  }

  return session.elements;
}
