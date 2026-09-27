// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GrocerCheckout } from "../src/components/ar/grocer-checkout";
import type { GrocerCart } from "../src/lib/ar-grocer-cart";

const cart: GrocerCart = {
  merchant: "Example Grocer", subtotalCents: 548, checkoutToken: "signed-cart", expiresAt: "2026-09-27T01:00:00.000Z",
  items: [
    { query: "Pasta", title: "Pasta box", merchantUrl: "https://grocer.example/pasta", imageUrl: null, unitPriceCents: 199, quantity: 2, lineTotalCents: 398, observedAt: "2026-09-27T00:00:00.000Z" },
    { query: "Tomatoes", title: "Tomato can", merchantUrl: "https://grocer.example/tomatoes", imageUrl: null, unitPriceCents: 150, quantity: 1, lineTotalCents: 150, observedAt: "2026-09-27T00:00:00.000Z" },
  ],
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("reviews every priced grocery and labels the checkout as test only", () => {
  render(<GrocerCheckout carts={[cart]} />);
  expect(screen.getByText("Example Grocer")).toBeTruthy();
  expect(screen.getByText("$5.48")).toBeTruthy();
  fireEvent.click(screen.getByText("Review all groceries"));
  expect(screen.getByText("Pasta box")).toBeTruthy();
  expect(screen.getByText("Tomato can")).toBeTruthy();
  expect(screen.getByText("Pasta · 2 × $1.99")).toBeTruthy();
  expect(screen.getAllByRole("link", { name: "View listing ↗" }).map((link) => link.getAttribute("href")))
    .toEqual(["https://grocer.example/pasta", "https://grocer.example/tomatoes"]);
  expect(screen.getByText(/Test payment — no groceries ordered/)).toBeTruthy();
});

it("explains when there is no complete cart", () => {
  render(<GrocerCheckout carts={[]} />);
  expect(screen.getByText("No complete single grocer cart yet")).toBeTruthy();
  expect(screen.getByText(/individual offers for each ingredient below/)).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("discloses saved prices and their observed date without describing them as live", () => {
  const cachedCart: GrocerCart = { ...cart, items: cart.items.map((item) => ({ ...item, priceSource: "cached" })) };
  render(<GrocerCheckout carts={[cachedCart]} />);
  expect(screen.getByText(/Saved listing prices · checked Sep 27, 2026/)).toBeTruthy();
  expect(screen.queryByText(/Listed subtotal · 2 items/)).toBeNull();
  fireEvent.click(screen.getByText("Review all groceries"));
  expect(screen.getAllByText("Saved listing price · checked Sep 27, 2026")).toHaveLength(2);
});

it("discloses a mixed cart without labelling every price as saved", () => {
  const mixedCart: GrocerCart = { ...cart, items: [{ ...cart.items[0], priceSource: "cached" }, { ...cart.items[1], priceSource: "live" }] };
  render(<GrocerCheckout carts={[mixedCart]} />);
  expect(screen.getByText(/Includes saved listing prices/)).toBeTruthy();
  fireEvent.click(screen.getByText("Review all groceries"));
  expect(screen.getAllByText(/Saved listing price · checked/)).toHaveLength(1);
});

it("posts the signed quote once, rejects an unsafe redirect, and allows retry", async () => {
  let finish!: (response: Response) => void;
  const first = new Promise<Response>((resolve) => { finish = resolve; });
  const fetcher = vi.fn<typeof fetch>().mockReturnValueOnce(first)
    .mockResolvedValueOnce(Response.json({ error: "Quote expired. Review a new cart." }, { status: 409 }));
  vi.stubGlobal("fetch", fetcher);
  render(<GrocerCheckout carts={[cart]} />);
  const button = screen.getByRole("button", { name: "Buy all · Stripe test checkout" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("/api/ar/activity/checkout");
  expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toEqual({ checkoutToken: "signed-cart", expectedTotalCents: 548 });
  finish(Response.json({ checkoutUrl: "https://checkout.stripe.com.evil.example/session" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The checkout link was invalid. Please try again. Tap the button to retry.");
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Quote expired. Review a new cart. Tap the button to retry.");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
