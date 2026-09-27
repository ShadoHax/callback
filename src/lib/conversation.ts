import type { Message } from "./use-inbox";

type ScanConversation = { scanId: string; userId: string; purpose: "connection" | "advice"; personId?: string };
const chronological = (a: Message, b: Message) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);

/** Reopen a persisted exchange instead of offering to send the same discovery again after navigation. */
export function findScanConversation(messages: Message[], input: ScanConversation) {
  if (!input.userId) return null;
  return messages.filter((message) => message.sender_id === input.userId && message.scan_id === input.scanId && !message.reply_to
    && (message.purpose ?? "connection") === input.purpose
    && (input.purpose !== "advice" || message.about_person_id === input.personId))
    .sort(chronological).at(-1) ?? null;
}

/** Follow reply-to links, including replies to replies; never mix another discovery or pair of people in. */
export function conversationMessages(messages: Message[], rootId: string) {
  const root = messages.find((message) => message.id === rootId);
  const included = new Set([rootId]);
  const participants = root ? new Set([root.sender_id, root.recipient_id]) : null;
  let changed = true;
  while (changed) {
    changed = false;
    for (const message of messages) {
      if (included.has(message.id) || !message.reply_to || !included.has(message.reply_to)) continue;
      if (participants && (!participants.has(message.sender_id) || !participants.has(message.recipient_id))) continue;
      included.add(message.id); changed = true;
    }
  }
  return messages.filter((message) => included.has(message.id)).sort(chronological);
}
