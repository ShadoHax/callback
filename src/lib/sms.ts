import { z } from "zod";

const e164 = /^\+[1-9]\d{7,14}$/;
const recipients = z.record(z.string().uuid(), z.record(z.string(), z.string().regex(e164)));

export function smsRecipient(ownerId: string, personId: string) {
  const raw = process.env.SMS_RECIPIENTS_JSON;
  if (!raw) return null;
  try {
    const byOwner = recipients.parse(JSON.parse(raw))[ownerId];
    return byOwner && Object.prototype.hasOwnProperty.call(byOwner, personId) ? byOwner[personId] : null;
  } catch { throw new Error("SMS_RECIPIENTS_JSON must map owner UUIDs to person IDs and E.164 mobile numbers."); }
}
