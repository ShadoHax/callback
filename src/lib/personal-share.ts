export type PersonalShareResult = "shared" | "copied" | "cancelled";

/**
 * Hands the user's edited words to the operating system. Callback never chooses
 * the recipient or presses the final send button in SMS, Instagram, WhatsApp,
 * or another personal app.
 */
export async function sharePersonalMessage(text: string): Promise<PersonalShareResult> {
  const body = text.trim();
  if (!body) throw new Error("Write a message before sharing.");

  if (typeof navigator.share === "function") {
    try {
      await navigator.share({ text: body });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      throw error;
    }
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(body);
    return "copied";
  }
  throw new Error("Sharing is not available on this device.");
}

export function isIosDevice(userAgent = navigator.userAgent) {
  return /iPad|iPhone|iPod/i.test(userAgent);
}

export function personalSmsHref(phone: string, text: string, userAgent = navigator.userAgent) {
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Invalid SMS phone number.");
  // Apple's documented web sms: URL supports a recipient but explicitly does
  // not support message text. Android messaging apps commonly accept body=.
  if (isIosDevice(userAgent)) return `sms:${phone}`;
  return `sms:${phone}?body=${encodeURIComponent(text.trim())}`;
}

export function openPersonalSms(phone: string, text: string) {
  const link = document.createElement("a");
  link.href = personalSmsHref(phone, text);
  link.rel = "noreferrer";
  link.click();
}
