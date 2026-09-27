import { afterEach, expect, it } from "vitest";
import { smsRecipient } from "../src/lib/sms";

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });

it("scopes private phone mappings by owner as well as person ID", () => {
  const alex = "885edbf2-d497-4f6f-a2cf-342711970000";
  const jordan = "885edbf2-d497-4f6f-a2cf-342711970001";
  process.env.SMS_RECIPIENTS_JSON = JSON.stringify({ [alex]: { maya: "+12175550123" }, [jordan]: { maya: "+12175550124" } });
  expect(smsRecipient(alex, "maya")).toBe("+12175550123");
  expect(smsRecipient(jordan, "maya")).toBe("+12175550124");
  expect(smsRecipient(alex, "noah")).toBeNull();
  expect(smsRecipient("885edbf2-d497-4f6f-a2cf-342711970002", "maya")).toBeNull();
});

it("rejects the old global person map", () => {
  process.env.SMS_RECIPIENTS_JSON = JSON.stringify({ maya: "+12175550123" });
  expect(() => smsRecipient("885edbf2-d497-4f6f-a2cf-342711970000", "maya")).toThrow(/owner UUIDs/);
});
