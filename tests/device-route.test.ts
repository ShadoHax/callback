import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticateDevice: vi.fn(), scanResponse: vi.fn(), validImage: vi.fn(() => true), adminSupabase: vi.fn() }));
vi.mock("@/lib/device-auth", () => ({ authenticateDevice: mocks.authenticateDevice }));
vi.mock("@/lib/admin-supabase", () => ({ adminSupabase: mocks.adminSupabase }));
vi.mock("@/lib/scan-stream", () => ({ scanFailure: (message: string, status: number) => new Response(message, { status }), scanResponse: mocks.scanResponse, validImage: mocks.validImage }));

import { POST } from "../src/app/api/device/scans/route";

afterEach(() => { mocks.authenticateDevice.mockReset(); mocks.scanResponse.mockReset(); mocks.adminSupabase.mockReset(); delete process.env.SUPABASE_SERVICE_ROLE_KEY; delete process.env.NEXT_PUBLIC_SUPABASE_URL; });

it("does not scan without an active bearer credential", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  mocks.authenticateDevice.mockResolvedValue(null);
  const response = await POST(new Request("http://localhost/api/device/scans", { method: "POST" }));
  expect(response.status).toBe(401);
  expect(mocks.scanResponse).not.toHaveBeenCalled();
});

it("does not allow a Pi token to submit a scan", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  mocks.authenticateDevice.mockResolvedValue({ id: "device", ownerId: "owner", kind: "pi" });
  const response = await POST(new Request("http://localhost/api/device/scans", { method: "POST" }));
  expect(response.status).toBe(403);
  expect(mocks.scanResponse).not.toHaveBeenCalled();
});

it("sets the source from the token rather than a client form field", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  mocks.authenticateDevice.mockResolvedValue({ id: "device", ownerId: "owner", kind: "quest" });
  mocks.adminSupabase.mockReturnValue({ rpc: async () => ({ data: true, error: null }) });
  mocks.scanResponse.mockReturnValue(new Response("ok"));
  const form = new FormData(); form.set("image", new File(["jpg"], "photo.jpg", { type: "image/jpeg" })); form.set("captureSource", "glasses");
  const response = await POST(new Request("http://localhost/api/device/scans", { method: "POST", headers: { authorization: "Bearer token" }, body: form }));
  expect(response.status).toBe(200);
  expect(mocks.scanResponse).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "owner", captureSource: "quest", deviceId: "device" }));
});

it("throttles repeated device scans before model inference", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  mocks.authenticateDevice.mockResolvedValue({ id: "device", ownerId: "owner", kind: "glasses" });
  mocks.adminSupabase.mockReturnValue({ rpc: async () => ({ data: false, error: null }) });
  const form = new FormData(); form.set("image", new File(["jpg"], "photo.jpg", { type: "image/jpeg" }));
  const response = await POST(new Request("http://localhost/api/device/scans", { method: "POST", headers: { authorization: "Bearer token" }, body: form }));
  expect(response.status).toBe(429);
  expect(mocks.scanResponse).not.toHaveBeenCalled();
});

it("parses the native adapters' multipart wire format", async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only"; process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  mocks.authenticateDevice.mockResolvedValue({ id: "device", ownerId: "owner", kind: "glasses" });
  mocks.adminSupabase.mockReturnValue({ rpc: async () => ({ data: true, error: null }) });
  mocks.scanResponse.mockReturnValue(new Response("ok"));
  const boundary = "callback-test-boundary";
  const wire = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="glasses.jpg"\r\nContent-Type: image/jpeg\r\n\r\nJPEG_BYTES\r\n--${boundary}--\r\n`;
  const response = await POST(new Request("http://localhost/api/device/scans", { method: "POST", headers: { authorization: "Bearer token", "content-type": `multipart/form-data; boundary=${boundary}` }, body: wire }));
  expect(response.status).toBe(200);
  const image = mocks.scanResponse.mock.calls[0][0].image as File;
  expect(image.name).toBe("glasses.jpg");
  expect(image.type).toBe("image/jpeg");
  expect(await image.text()).toBe("JPEG_BYTES");
});
