import { test } from "node:test";
import assert from "node:assert/strict";
import { id } from "../src/sundhed.ts";

test("id passes the ids sundhed.dk returns", () => {
  // Prescription (15 digits), vaccination (11) and ordination (9) ids.
  for (const value of ["352198765432101", "32157900001", "123456789", 42, "a1b2-c3_d4"]) assert.equal(id(value), String(value));
});

test("id refuses anything that could leave its path segment", () => {
  for (const value of ["..", ".", "../../app/other/api", "1/2", "1?x=y", "1#x", "%2e%2e", "", "x".repeat(65)]) assert.throws(() => id(value), /Not a valid id/);
});
