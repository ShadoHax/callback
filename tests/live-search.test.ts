import { describe, expect, it } from "vitest";
import { shoppingSearchLinks } from "../src/lib/commerce/live-search";
import type { Observed } from "../src/lib/commerce/catalog";

describe("shopping search links", () => {
  it("routes free Sony webcam software to official Sony information and related camera searches", () => {
    const observed: Observed = { item: "Imaging Edge Webcam", title: "Imaging Edge Webcam", specificity: "exact_title" };
    const result = shoppingSearchLinks(observed);
    expect(result).toMatchObject({
      query: "Sony cameras for Imaging Edge Webcam",
      searchUrl: "https://www.ebay.com/sch/i.html?_nkw=Sony%20cameras%20for%20Imaging%20Edge%20Webcam",
      shoppingUrl: "https://www.google.com/search?tbm=shop&q=Sony%20cameras%20for%20Imaging%20Edge%20Webcam",
      software: { title: "Imaging Edge Webcam", price: "Free from Sony", source: "Sony" },
    });
    expect(result.software?.downloadUrl).toBe("https://support.d-imaging.sony.co.jp/app/webcam/l/download/");
    expect(result.software?.supportUrl).toContain("sony.com/electronics/support/");
    expect(result.message).toMatch(/free software.*live external searches.*camera hardware/i);
    expect("price" in result).toBe(false);
  });

  it("uses the identified product name in live external retailer searches without manufacturing offers", () => {
    const observed: Observed = { item: "Fujifilm X100VI", title: "Fujifilm X100VI", specificity: "exact_title" };
    const result = shoppingSearchLinks(observed);
    expect(result).toMatchObject({
      query: "Fujifilm X100VI",
      searchUrl: "https://www.ebay.com/sch/i.html?_nkw=Fujifilm%20X100VI",
      shoppingUrl: "https://www.google.com/search?tbm=shop&q=Fujifilm%20X100VI",
      software: null,
      message: "These links open live search results on external retailer sites.",
    });
    expect("listings" in result).toBe(false);
  });

  it("rejects a scan without an identified product name", () => {
    expect(() => shoppingSearchLinks({ item: "", title: "", specificity: "category" })).toThrow(/product name/);
  });
});
