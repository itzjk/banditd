import { NextResponse } from "next/server";
import { fromOurPage, OFF_PAGE_CODE, OFF_PAGE_MESSAGE } from "@/lib/same-origin";
import { openSession } from "@/lib/store";
import { startAgentTurn, resumeAgentTurn, startBudget, failureBody } from "@/lib/openai";
import type { AgentStep, AgentToolOutput, ChatTurn } from "@/lib/openai";
import { buildSnapshot, clean } from "./snapshot";

export const maxDuration = 120;

const BUDGET_MS = Number(process.env.CHAT_BUDGET_MS ?? 60000);
const MAX_TURNS = 10;
const MAX_QUESTION = 700;
const MAX_ANSWER = 1200;
const MAX_OUTPUTS = 4;
const MAX_OUTPUT_CHARS = 6000;

function readTurns(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) return [];
  const turns: ChatTurn[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { role?: unknown; content?: unknown };
    const role = item.role === "assistant" ? "assistant" : item.role === "user" ? "user" : null;
    if (!role) continue;
    const content = clean(item.content, role === "user" ? MAX_QUESTION : MAX_ANSWER);
    if (!content) continue;
    turns.push({ role, content });
  }
  return turns.slice(-MAX_TURNS);
}

function readOutputs(value: unknown): AgentToolOutput[] {
  if (!Array.isArray(value)) return [];
  const outputs: AgentToolOutput[] = [];
  for (const raw of value.slice(0, MAX_OUTPUTS)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { callId?: unknown; output?: unknown };
    if (typeof item.callId !== "string" || !/^call_[A-Za-z0-9_-]{4,120}$/.test(item.callId)) {
      continue;
    }
    const output = clean(item.output, MAX_OUTPUT_CHARS);
    outputs.push({ callId: item.callId, output: output || '{"ok":false,"error":"empty result"}' });
  }
  return outputs;
}

function answerOf(step: AgentStep) {
  if (step.calls.length > 0) {
    return NextResponse.json({
      pending: { responseId: step.responseId, calls: step.calls },
      note: step.text || null,
    });
  }
  return NextResponse.json({ answer: step.text });
}

export async function POST(req: Request) {
  if (!fromOurPage(req)) {
    return NextResponse.json({ error: OFF_PAGE_MESSAGE, code: OFF_PAGE_CODE }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    messages?: unknown;
    state?: unknown;
    responseId?: unknown;
    outputs?: unknown;
  };

  const budget = startBudget("The answer", BUDGET_MS);
  const started = Date.now();

  const resuming =
    typeof body.responseId === "string" && /^resp_[A-Za-z0-9_-]{6,200}$/.test(body.responseId);

  if (resuming) {
    const outputs = readOutputs(body.outputs);
    if (outputs.length === 0) {
      return NextResponse.json(
        { error: "The tool results did not come back in a shape the agent could read." },
        { status: 400 },
      );
    }
    try {
      const step = await resumeAgentTurn(body.responseId as string, outputs, budget);
      return answerOf(step);
    } catch (err) {
      const { status, body: payload } = failureBody(err);
      console.error(
        `chat gave up resuming after ${Math.round((Date.now() - started) / 1000)}s: ${payload.code}`,
        err,
      );
      return NextResponse.json(payload, { status });
    }
  }

  const turns = readTurns(body.messages);
  if (turns.length === 0 || turns[turns.length - 1].role !== "user") {
    return NextResponse.json(
      { error: "Send a question and the agent will answer it from this run." },
      { status: 400 },
    );
  }

  const session = openSession(body.state);
  const snapshot = buildSnapshot(session.state);

  try {
    const step = await startAgentTurn(turns, snapshot, budget);
    return answerOf(step);
  } catch (err) {
    const { status, body: payload } = failureBody(err);
    console.error(
      `chat gave up after ${Math.round((Date.now() - started) / 1000)}s: ${payload.code}`,
      err,
    );
    return NextResponse.json(payload, { status });
  }
}
