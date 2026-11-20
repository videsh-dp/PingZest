import { test } from "node:test";
import assert from "node:assert/strict";
import { toId } from "../app/lib/ids.js";

test("toId accepts MongoDB ObjectIds only", () => {
  assert.equal(toId("65F1a2b3c4d5e6f708192a3b"), "65f1a2b3c4d5e6f708192a3b");
  assert.equal(toId(" 65f1a2b3c4d5e6f708192a3b "), "65f1a2b3c4d5e6f708192a3b");
  for (const bad of ["", null, undefined, "12", 12, "65f1a2b3c4d5e6f708192a3", "zzf1a2b3c4d5e6f708192a3b", "{$ne:1}"]) {
    assert.equal(toId(bad), null, String(bad));
  }
});
