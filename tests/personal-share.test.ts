// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { personalSmsHref, sharePersonalMessage } from "../src/lib/personal-share";

afterEach(() => vi.restoreAllMocks());

it("shares only the edited message text through the operating system", async () => {
  const share = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "share", { configurable: true, value: share });
  await expect(sharePersonalMessage("  Want to play Wingspan Sunday?  ")).resolves.toBe("shared");
  expect(share).toHaveBeenCalledWith({ text: "Want to play Wingspan Sunday?" });
});

it("copies the message when the native share sheet is unavailable", async () => {
  Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await expect(sharePersonalMessage("Thought of you!")).resolves.toBe("copied");
  expect(writeText).toHaveBeenCalledWith("Thought of you!");
});

it("treats closing the share sheet as cancellation", async () => {
  Object.defineProperty(navigator, "share", { configurable: true, value: vi.fn(async () => { throw new DOMException("closed", "AbortError"); }) });
  await expect(sharePersonalMessage("Thought of you!")).resolves.toBe("cancelled");
});

it("opens a prefilled native SMS addressed from the user's own phone", () => {
  expect(personalSmsHref("+12175550123", "Coffee next week?", "Android")).toBe("sms:+12175550123?body=Coffee%20next%20week%3F");
  expect(personalSmsHref("+12175550123", "Coffee next week?", "iPhone")).toBe("sms:+12175550123");
});
