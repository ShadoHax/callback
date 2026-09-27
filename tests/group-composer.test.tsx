// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GroupComposer } from "../src/components/group-composer";
import type { ScanResult } from "../src/lib/scan-types";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("sends the same explicit callback to every linked group member", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: crypto.randomUUID() }));
  vi.stubGlobal("fetch", fetcher);
  const people = ["maya", "noah"].map((personId) => ({ personId, personName: personId === "maya" ? "Maya" : "Noah", recipientId: crypto.randomUUID(), relation: "experienced_together", mention: "Wingspan", sourceIds: [], evidence: [] }));
  const result: ScanResult = { scanId: crypto.randomUUID(), status: "matched", observedEntity: "Wingspan", people };
  render(<GroupComposer result={result} refresh={vi.fn(async () => {})} />);
  fireEvent.click(screen.getByRole("button", { name: /Send to 2 friends/ }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const payloads = fetcher.mock.calls.map((call) => JSON.parse(call[1]?.body as string));
  expect(new Set(payloads.map((payload) => payload.body)).size).toBe(1);
  expect(new Set(payloads.map((payload) => payload.recipientId))).toEqual(new Set(people.map((person) => person.recipientId)));
});

it("suggests an immediate group hello when an opted-in member may be there", () => {
  vi.stubGlobal("fetch", vi.fn());
  const people = [
    { personId: "maya", personName: "Maya", recipientId: crypto.randomUUID(), relation: "experienced_together", mention: "Wingspan", sourceIds: [], evidence: [], proximity: { status: "same_place" as const, distanceBand: "within_75m" as const, checkedAt: new Date().toISOString() } },
    { personId: "noah", personName: "Noah", recipientId: crypto.randomUUID(), relation: "experienced_together", mention: "Wingspan", sourceIds: [], evidence: [] },
  ];
  render(<GroupComposer result={{ scanId: crypto.randomUUID(), status: "matched", people }} refresh={vi.fn(async () => {})} />);
  expect(screen.getByDisplayValue(/Maya may be here too/i)).toBeTruthy();
});

it("shows a partial delivery and retries only the unconfirmed recipient with the same payload", async () => {
  const people = ["maya", "noah"].map((personId) => ({ personId, personName: personId === "maya" ? "Maya" : "Noah", recipientId: crypto.randomUUID(), relation: "experienced_together", mention: "Wingspan", sourceIds: [], evidence: [] }));
  let noahAttempts = 0;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    if (payload.recipientId === people[1].recipientId && ++noahAttempts === 1) return new Response(null, { status: 503 });
    return Response.json({ id: crypto.randomUUID() });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<GroupComposer result={{ scanId: crypto.randomUUID(), status: "matched", people }} refresh={vi.fn(async () => {})} />);
  fireEvent.click(screen.getByRole("button", { name: /Send to 2 friends/ }));
  expect(await screen.findByText(/Delivered to Maya/)).toBeTruthy();
  expect(screen.getByText(/Delivery to Noah could not be confirmed/)).toBeTruthy();
  expect(screen.getByRole("textbox")).toHaveProperty("readOnly", true);
  fireEvent.click(screen.getByRole("button", { name: /Retry for 1 friend/ }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  const payloads = fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
  expect(payloads[2]).toEqual(payloads[1]);
  expect(await screen.findByText(/Sent the callback to Maya, Noah/)).toBeTruthy();
});

it("uses a new send ID when editing a definitively failed recipient's retry", async () => {
  const people = ["maya", "noah"].map((personId) => ({ personId, personName: personId === "maya" ? "Maya" : "Noah", recipientId: crypto.randomUUID(), relation: "experienced_together", mention: "Wingspan", sourceIds: [], evidence: [] }));
  let noahAttempts = 0;
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    if (payload.recipientId === people[1].recipientId && ++noahAttempts === 1) return Response.json({ error: "Try again." }, { status: 400 });
    return Response.json({ id: crypto.randomUUID() });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<GroupComposer result={{ scanId: crypto.randomUUID(), status: "matched", people }} refresh={vi.fn(async () => {})} />);
  fireEvent.click(screen.getByRole("button", { name: /Send to 2 friends/ }));
  expect(await screen.findByText(/Delivered to Maya/)).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toMatch(/Noah: Try again/);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Edited callback for Noah" } });
  fireEvent.click(screen.getByRole("button", { name: /Retry for 1 friend/ }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  const payloads = fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
  expect(payloads[2].recipientId).toBe(people[1].recipientId);
  expect(payloads[2].body).toBe("Edited callback for Noah");
  expect(payloads[2].clientRequestId).not.toBe(payloads[1].clientRequestId);
  expect(await screen.findByText(/Sent the callback to Maya, Noah/)).toBeTruthy();
});
