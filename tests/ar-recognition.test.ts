import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ structuredCall: vi.fn(), prepareVisionImage: vi.fn() }));
vi.mock("@/lib/model", () => ({ structuredCall: mocks.structuredCall,
  modelDisplayConfig: () => ({ provider: "meta", model: "muse-spark-1.3", visionModel: "muse-spark-1.1" }) }));
vi.mock("@/lib/vision-image", () => ({ prepareVisionImage: mocks.prepareVisionImage }));

import { recognizeArObject } from "../src/lib/ar-demo";

const value = (item: string, title = item) => ({ detected: true, confidence: 0.97,
  item, category: "soda", title, specificity: "exact_title", visibleText: [title], ambiguity: "",
  boxVisible: true, boundingBox: { x: 0.2, y: 0.1, width: 0.6, height: 0.8 }, topicMatches: [] });

beforeEach(() => {
  mocks.structuredCall.mockReset();
  mocks.prepareVisionImage.mockReset().mockResolvedValue({ url: "data:image/jpeg;base64,AA==", metrics: { width: 500, height: 500 } });
});

it("keeps the model's visible brand and variant without a demo category", async () => {
  for (const product of ["Coca-Cola Original Taste", "Diet Coke"]) {
    mocks.structuredCall.mockResolvedValueOnce({ value: value(product), ms: 50, model: "muse-spark-1.3", attempts: 1, timings: {} });
    const result = await recognizeArObject(new File(["image"], "frame.jpg", { type: "image/jpeg" }));
    expect(result).toMatchObject({ detected: true, identification: { item: product, title: product,
      category: "soda", specificity: "exact_title", visibleText: [product], boundingBox: { width: 0.6 } } });
    expect(result).not.toHaveProperty("scenario");
  }
  expect(mocks.structuredCall).toHaveBeenCalledWith(expect.objectContaining({ modelOverride: "muse-spark-1.1", purpose: "vision" }));
  const prompt = mocks.structuredCall.mock.calls[0][0].instructions as string;
  expect(prompt).not.toContain("Coca-Cola");
  expect(prompt).not.toContain("Diet Coke");
});

it("does not promote an uncertain scene or accept unknown topics", async () => {
  mocks.structuredCall.mockResolvedValue({ value: { ...value("coffee"), confidence: 0.65,
    topicMatches: [{ topic: "someone else's private topic", confidence: 1, specific: true }] },
    ms: 50, model: "muse-spark-1.3", attempts: 1, timings: {} });
  const result = await recognizeArObject(new File(["image"], "frame.jpg", { type: "image/jpeg" }), undefined, [{ topic: "art", cues: [] }]);
  expect(result.detected).toBe(false);
  expect(result.identification.topicMatches).toEqual([]);
});

it("keeps a clear broad object identity even when its product and topic association are unknown", async () => {
  mocks.structuredCall.mockResolvedValue({ value: { ...value("unmarked container", ""), category: "drinkware",
    specificity: "category", confidence: 0.88, visibleText: [], ambiguity: "Contents not visible",
    topicMatches: [{ topic: "beverages", confidence: 0.3, specific: false }] },
    ms: 50, model: "muse-spark-1.1", attempts: 1, timings: {} });
  const result = await recognizeArObject(new File(["image"], "frame.jpg", { type: "image/jpeg" }), undefined,
    [{ topic: "beverages", cues: ["drink container"] }]);
  expect(result).toMatchObject({ detected: true, identification: { item: "unmarked container", title: "",
    category: "drinkware", specificity: "category", confidence: 0.88, topicMatches: [] } });
  const prompt = mocks.structuredCall.mock.calls[0][0].instructions as string;
  expect(prompt).toContain("top-level confidence is ONLY confidence in that visible item label");
  expect(prompt).toContain("Give a directly matching cue a strong topicMatches.confidence");
  expect(prompt).toContain("choose that object rather than its supporting surface or background");
  expect(prompt).toContain("a closed or unmarked container does not prove its contents");
});

it("clips an approximate box into image bounds and rejects an unlocated one", async () => {
  mocks.structuredCall.mockResolvedValueOnce({ value: { ...value("bottle"), boundingBox: { x: 0.8, y: 0.9, width: 0.3, height: 0.2 } },
    ms: 50, model: "muse-spark-1.3", attempts: 1, timings: {} });
  const clipped = await recognizeArObject(new File(["image"], "frame.jpg", { type: "image/jpeg" }));
  expect(clipped.identification.boundingBox?.width).toBeCloseTo(0.2);
  expect(clipped.identification.boundingBox?.height).toBeCloseTo(0.1);
  mocks.structuredCall.mockResolvedValueOnce({ value: { ...value("bottle"), boxVisible: false },
    ms: 50, model: "muse-spark-1.3", attempts: 1, timings: {} });
  const unlocated = await recognizeArObject(new File(["image"], "frame.jpg", { type: "image/jpeg" }));
  expect(unlocated.identification.boundingBox).toBeNull();
});

it("normalizes Muse's 0–1000 boxes without rejecting the correct product identity", async () => {
  mocks.structuredCall.mockResolvedValue({value:{...value("Diet Coke"),boundingBox:{x:25,y:195,width:950,height:660}},ms:50,model:"test",attempts:1,timings:{}});
  const result=await recognizeArObject(new File(["image"],"frame.jpg",{type:"image/jpeg"}));
  expect(result.detected).toBe(true);
  expect(result.identification.boundingBox).toEqual({x:.025,y:.195,width:.95,height:.66});
});
