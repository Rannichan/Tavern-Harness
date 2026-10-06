import { db } from '../db/database';
import type { NpcCharacter } from '../types/models';
import { sessionPreviewText } from './stats';

export async function seedOpeningGreeting(
  sessionId: number,
  npc: NpcCharacter,
  speakerName = npc.name,
  displayHandoffMention: string | null = null,
): Promise<string> {
  const greetings = [npc.greeting, ...(npc.alternateGreetings ?? [])].filter(Boolean);
  const greeting = greetings.length > 0 ? greetings[Math.floor(Math.random() * greetings.length)] : '';
  if (!greeting) return '';

  await db.messages.add({
    sessionId,
    role: 'assistant',
    speakerParticipantId: npc.id!,
    speakerName,
    content: greeting,
    isOpeningGreeting: true,
    displayHandoffMention,
    toolCallsJson: '[]',
    toolCallId: null,
    thinkingContent: null,
    loopIndex: 0,
    timestamp: Date.now(),
    latencyMs: null,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    tokensPerSec: null,
    modelUsed: null,
    attachments: [],
    attachmentInfos: [],
    displayRef: null,
    rawRequestBody: null,
    rawResponseBody: null,
  });
  return sessionPreviewText(greeting);
}
