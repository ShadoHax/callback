import { expect, it } from "vitest";
import { conversationMessages, findScanConversation } from "../src/lib/conversation";
import type { Message } from "../src/lib/use-inbox";

const message = (id: string, extra: Partial<Message> = {}): Message => ({ id, sender_id: "alex", recipient_id: "maya-account", body: id, created_at: `2026-09-26T12:00:0${id.replace(/\D/g, "") || "0"}Z`, scan_id: "scan", purpose: "connection", ...extra });

it("restores only this owner's latest connection for this scan", () => {
  const root = message("2");
  const messages = [message("1"), root, message("3", { sender_id: "someone-else" }), message("4", { scan_id: "another" }), message("5", { reply_to: "2" })];
  expect(findScanConversation(messages, { scanId: "scan", userId: "alex", purpose: "connection" })).toEqual(root);
  expect(findScanConversation(messages, { scanId: "scan", userId: "", purpose: "connection" })).toBeNull();
});

it("keeps advice and reconnect threads separate even on the same recipient phone", () => {
  const messages = [message("1"), message("2", { purpose: "advice", about_person_id: "noah" }), message("3", { purpose: "advice", about_person_id: "priya" })];
  expect(findScanConversation(messages, { scanId: "scan", userId: "alex", purpose: "connection" })?.id).toBe("1");
  expect(findScanConversation(messages, { scanId: "scan", userId: "alex", purpose: "advice", personId: "noah" })?.id).toBe("2");
});

it("reconstructs nested replies in order without mixing other conversations or people", () => {
  const messages = [message("3", { reply_to: "2", scan_id: null }), message("2", { sender_id: "maya-account", recipient_id: "alex", reply_to: "1", scan_id: null }), message("1"), message("4", { reply_to: "elsewhere" }), message("5", { sender_id: "outsider", reply_to: "2" }), message("6", { reply_to: "7" }), message("7", { reply_to: "6" })];
  expect(conversationMessages(messages, "1").map((item) => item.id)).toEqual(["1", "2", "3"]);
});

it("shows incoming replies while the just-sent root has not reached polling yet", () => {
  expect(conversationMessages([message("2", { reply_to: "1" })], "1").map((item) => item.id)).toEqual(["2"]);
});
