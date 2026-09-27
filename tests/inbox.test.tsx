// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useInbox } from "../src/lib/use-inbox";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/browser-supabase", () => ({ browserSupabase: mocks.client }));
beforeEach(() => {
  mocks.client.mockReset(); mocks.client.mockReturnValue(null);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ userId: "owner", messages: [] })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("waits for authentication and subscription confirmation before reporting Live", async () => {
  let authenticated!: () => void, status!: (value: string) => void;
  const ready = new Promise<void>((resolve) => { authenticated = resolve; });
  const subscribe = vi.fn((callback) => { status = callback; return channel; });
  const channel = { on: vi.fn().mockReturnThis(), subscribe };
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) }, realtime: { setAuth: vi.fn(() => ready) }, channel: vi.fn(() => channel), removeChannel: vi.fn() };
  mocks.client.mockReturnValue(client);
  const { result } = renderHook(() => useInbox());
  await waitFor(() => expect(client.realtime.setAuth).toHaveBeenCalled());
  expect(client.channel).not.toHaveBeenCalled();
  expect(result.current.live).toBe(false);
  await act(async () => authenticated());
  expect(client.channel).toHaveBeenCalledWith("inbox-owner", { config: { postgres_changes_options: { wait: true, timeout: 15000 } } });
  expect(result.current.live).toBe(false);
  act(() => status("SUBSCRIBED"));
  expect(result.current.live).toBe(true);
  act(() => status("CHANNEL_ERROR"));
  expect(result.current.live).toBe(false);
});

it("does not open a late subscription after the inbox unmounts", async () => {
  let authenticated!: () => void;
  const ready = new Promise<void>((resolve) => { authenticated = resolve; });
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) }, realtime: { setAuth: vi.fn(() => ready) }, channel: vi.fn(), removeChannel: vi.fn() };
  mocks.client.mockReturnValue(client);
  const { unmount } = renderHook(() => useInbox());
  await waitFor(() => expect(client.realtime.setAuth).toHaveBeenCalled());
  unmount();
  await act(async () => authenticated());
  expect(client.channel).not.toHaveBeenCalled();
});

it("never overlaps fallback polls and schedules the next poll after completion", async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const fetcher = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(Response.json({ userId: "owner", messages: [] }));
  vi.stubGlobal("fetch", fetcher);
  renderHook(() => useInbox());

  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { finish(Response.json({ userId: "owner", messages: [] })); await pending; });
  await act(async () => { await vi.advanceTimersByTimeAsync(3_999); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("keeps retrying after transient poll failures without immediately surfacing an error", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValue(Response.json({ userId: "owner", messages: [] }));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useInbox());

  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(result.current.error).toBe("");
  await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.current.error).toBe("");
  expect(result.current.userId).toBe("owner");
});

it("queues one fresh GET when explicit refreshes arrive during a stale GET", async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const newMessage = { id: "new", sender_id: "maya", recipient_id: "owner", body: "Reply", created_at: "2026-09-26T00:00:00Z" };
  const fetcher = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(Response.json({ userId: "owner", messages: [newMessage] }));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useInbox());
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(fetcher).toHaveBeenCalledTimes(1);

  let first!: Promise<void>, second!: Promise<void>;
  act(() => { first = result.current.refresh(); second = result.current.refresh(); });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(Response.json({ userId: "owner", messages: [] }));
    await Promise.all([first, second]);
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(result.current.messages).toEqual([newMessage]);
});

it("queues a fresh GET after a Realtime event during an older GET", async () => {
  vi.useFakeTimers();
  let onInsert!: () => void, finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const newMessage = { id: "reply", sender_id: "maya", recipient_id: "owner", body: "Here!", created_at: "2026-09-26T00:00:00Z" };
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ userId: "owner", messages: [] }))
    .mockReturnValueOnce(pending).mockResolvedValue(Response.json({ userId: "owner", messages: [newMessage] }));
  vi.stubGlobal("fetch", fetcher);
  const channel = { on: vi.fn((_event, _filter, callback) => { onInsert = callback; return channel; }), subscribe: vi.fn().mockReturnThis() };
  mocks.client.mockReturnValue({ auth: { getSession: async () => ({ data: { session: { access_token: "test-token" } } }) },
    realtime: { setAuth: async () => {} }, channel: () => channel, removeChannel: vi.fn() });
  const { result } = renderHook(() => useInbox());
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(onInsert).toBeTypeOf("function");

  let refresh!: Promise<void>;
  act(() => { refresh = result.current.refresh(); });
  expect(fetcher).toHaveBeenCalledTimes(2);
  act(() => onInsert());
  await act(async () => { finish(Response.json({ userId: "owner", messages: [] })); await refresh; });
  await act(async () => { await Promise.resolve(); });
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(result.current.messages).toEqual([newMessage]);
});

it("does not launch a queued refresh after unmount", async () => {
  vi.useFakeTimers();
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const fetcher = vi.fn().mockReturnValue(pending);
  vi.stubGlobal("fetch", fetcher);
  const { result, unmount } = renderHook(() => useInbox());
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  let refresh!: Promise<void>;
  act(() => { refresh = result.current.refresh(); });
  unmount();
  await act(async () => { finish(Response.json({ userId: "owner", messages: [] })); await refresh; });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
