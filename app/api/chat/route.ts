import { NextResponse } from "next/server";
import { startAgentTurn, resumeAgentTurn, startBudget } from "@/lib/openai";
import type { AgentStep, ChatTurn } from "@/lib/openai";
import { guard } from "@/lib/access";
import { readRun, updateRun, rememberChat } from "@/lib/run-store";
import type { Client } from "@/lib/access";
import { failure, readJson, HttpFailure } from "@/lib/http";
import { ChatInput } from "@/lib/contracts";
import { buildSnapshot, clean } from "./snapshot";

export const maxDuration = 120;

const BUDGET_MS = Number(process.env.CHAT_BUDGET_MS ?? 60000);
const MAX_TURNS = 10;
const MAX_QUESTION = 700;
const MAX_ANSWER = 1200;
const MAX_OUTPUT_CHARS = 6000;

function readTurns(messages: { role: "user" | "assistant"; content: string }[]): ChatTurn[] {
  return messages
    .map((m) => ({ role: m.role, content: clean(m.content, m.role === "user" ? MAX_QUESTION : MAX_ANSWER) }))
    .filter((m) => m.content.length > 0)
    .slice(-MAX_TURNS);
}

/**
 * A step that asks for tools is resumed later by its response id. The id is
 * recorded on the run, so a caller can only continue a conversation this run
 * started, not any stored response on the account.
 */
async function answerOf(runId: string, client: Client, step: AgentStep) {
  if (step.calls.length > 0) {
    await updateRun(runId, client, (record) => rememberChat(record, step.responseId));
    return NextResponse.json({
      pending: { responseId: step.responseId, calls: step.calls },
      note: step.text || null,
    });
  }
  return NextResponse.json({ answer: step.text });
}

export async function POST(req: Request) {
  const started = Date.now();
  try {
    const client = await guard(req, "model");
    const body = await readJson(req, ChatInput);
    const record = await readRun(body.runId, client);
    const budget = startBudget("The answer", BUDGET_MS);

    if ("responseId" in body) {
      if (!record.chat.includes(body.responseId)) {
        throw new HttpFailure(
          "UNKNOWN_RESPONSE",
          409,
          "That conversation step was not started by this run, so it cannot be continued here. Ask the question again.",
        );
      }
      const outputs = body.outputs.map((o) => ({
        callId: o.callId,
        output: clean(o.output, MAX_OUTPUT_CHARS) || '{"ok":false,"error":"empty result"}',
      }));
      return await answerOf(body.runId, client, await resumeAgentTurn(body.responseId, outputs, budget));
    }

    const turns = readTurns(body.messages);
    if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
      throw new HttpFailure(
        "NO_QUESTION",
        400,
        "Send a question and the agent will answer it from this run.",
      );
    }
    const step = await startAgentTurn(turns, buildSnapshot(record.state), budget);
    return await answerOf(body.runId, client, step);
  } catch (err) {
    if (!(err instanceof HttpFailure)) {
      console.error(`chat gave up after ${Math.round((Date.now() - started) / 1000)}s`, err);
    }
    return failure(err);
  }
}
