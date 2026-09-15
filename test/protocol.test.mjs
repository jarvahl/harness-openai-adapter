import test from "node:test";
import assert from "node:assert/strict";
import { contentText, modelList } from "../dist/protocol.js";

test("model discovery exposes only pi", () => {
  assert.deepEqual(modelList().data.map(model => model.id), ["pi"]);
});

test("contentText handles OpenAI text parts", () => {
  assert.equal(contentText([{ type: "text", text: "hello" }, { type: "image_url" }]), "hello");
});
