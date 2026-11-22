import { test } from "node:test";
import assert from "node:assert/strict";
import { clean, decodeEntities, isoDate, monthsAgo, redactCpr } from "../src/data.ts";

test("redactCpr masks CPR numbers with and without the dash", () => {
  assert.equal(redactCpr("CPR 010190-1234 on file"), "CPR [CPR] on file");
  assert.equal(redactCpr("0101901234"), "[CPR]");
  // Replacement numbers add 60 to the day.
  assert.equal(redactCpr("610190-1234"), "[CPR]");
});

test("redactCpr leaves ids that are not CPR numbers alone", () => {
  // Prescription (15 digits), vaccination (11) and ordination (9) ids.
  assert.equal(redactCpr("352198765432101"), "352198765432101");
  assert.equal(redactCpr("32157900001"), "32157900001");
  assert.equal(redactCpr("323860000"), "323860000");
  // Ten digits that cannot be a date.
  assert.equal(redactCpr("9913001234"), "9913001234");
});

test("decodeEntities turns sundhed.dk's HTML entities into text", () => {
  assert.equal(decodeEntities("v&#230;re logget p&#229;"), "være logget på");
  assert.equal(decodeEntities("A &amp; B &quot;x&quot;"), 'A & B "x"');
});

test("clean drops empty values and CPR fields but keeps false flags", () => {
  const out = clean({
    Drug: "Metformin &quot;Teva&quot;",
    EndDate: null,
    Note: "  ",
    Tags: [],
    Nested: { Empty: null },
    SubstitutionAllowed: false,
    Cpr: "0101901234",
    Issuer: "Læge for 010190-1234",
    Count: 0,
  });
  assert.deepEqual(out, { Drug: 'Metformin "Teva"', SubstitutionAllowed: false, Issuer: "Læge for [CPR]", Count: 0 });
});

test("clean handles arrays and returns undefined for nothing", () => {
  assert.deepEqual(clean([{ A: 1 }, { B: null }, null]), [{ A: 1 }]);
  assert.equal(clean([]), undefined);
  assert.equal(clean(null), undefined);
});

test("date helpers", () => {
  assert.equal(isoDate(new Date(2026, 8, 3)), "2026-09-03");
  assert.equal(isoDate(monthsAgo(12, new Date(2026, 8, 23))), "2025-09-23");
});
