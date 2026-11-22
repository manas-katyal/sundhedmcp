import { test } from "node:test";
import assert from "node:assert/strict";
import { countItems, dashboardPage, labChart, labNumber, labSeries, partOfSlug, partPage } from "../src/dashboard.ts";
import type { Snapshot } from "../src/snapshot.ts";

// Made-up lab results, nested the way a requisition holds its analyses; none of it is real.
const labResults = {
  Rekvisitioner: [
    {
      Proevetagningstidspunkt: "2025-03-01T08:00:00",
      Analyser: [
        { Analysenavn: "P-Testin", Vaerdi: "5,4", Enhed: "mmol/L", Referenceinterval: "3,5 - 5,0" },
        { Analysenavn: "B-Madeupcytter", Vaerdi: "<5", Enhed: "10^9/L" },
        { Analysenavn: "U-Tekst", Vaerdi: "negativ" },
      ],
    },
    {
      Proevetagningstidspunkt: "2024-09-01T08:00:00",
      Analyser: [{ Analysenavn: "P-Testin", Vaerdi: 4.2, Enhed: "mmol/L", NedreGraense: 3.5, OevreGraense: 5 }],
    },
  ],
};

const snapshot: Snapshot = {
  savedAt: "2026-01-02T10:00:00.000Z",
  fetchedAt: { medicationCard: "2026-01-02T10:00:00.000Z", labResults: "2026-01-02T10:00:00.000Z" },
  medicationCard: [{ OrdinationId: "ord-1", Drug: "Testamol 500 mg" }],
  medicationDetails: { "ord-1": { Drug: "Testamol 500 mg", Reason: "<b>Made up</b>" } },
  prescriptionDetails: {},
  vaccinationDetails: {},
  labResults: { from: "2016-01-02", to: "2026-01-02", results: labResults },
  errors: { referrals: "Made-up failure" },
};
const input = { snapshot, loggedIn: true, refreshing: false, sync: null, apiUrl: "https://sundhed.example.test/api/v1" };

test("lab results are found by shape, with dates from the requisition", () => {
  const series = labSeries(labResults);
  assert.deepEqual(
    series.map((s) => [s.name, s.points.length]),
    [["P-Testin", 2], ["B-Madeupcytter", 1]],
  );
  const testin = series[0];
  assert.deepEqual(testin?.points.map((p) => p.value), [4.2, 5.4]);
  assert.equal(testin?.unit, "mmol/L");
  assert.equal(testin?.low, 3.5);
  assert.equal(testin?.high, 5);
  assert.equal(series[1]?.points[0]?.text, "<5");
});

test("numbers are read as sundhed.dk writes them", () => {
  assert.equal(labNumber("5,4"), 5.4);
  assert.equal(labNumber("> 10"), 10);
  assert.equal(labNumber(7), 7);
  assert.equal(labNumber("negativ"), undefined);
  assert.equal(labNumber("1-2"), undefined);
});

test("parts are counted, whatever list they hold", () => {
  assert.equal(countItems([1, 2, 3]), 3);
  assert.equal(countItems({ Aktive: [1], Tidligere: [2, 3] }), 3);
  assert.equal(countItems({ Antal: 4 }), null);
  assert.equal(countItems(undefined), null);
});

test("the chart marks a value outside the range", () => {
  const [testin] = labSeries(labResults);
  const svg = labChart(testin as NonNullable<typeof testin>);
  assert.ok(svg.includes('class="band"'));
  assert.equal(svg.match(/class="dot out"/g)?.length, 1);
});

test("the pages show the copy, escaped", () => {
  assert.equal(partOfSlug("lab-results"), "labResults");
  assert.equal(partOfSlug("nope"), undefined);
  const overview = dashboardPage("en", input);
  assert.ok(overview.includes("1 item"));
  assert.ok(overview.includes("2 tests"));
  assert.ok(overview.includes("Made-up failure"));
  assert.ok(overview.includes("https://sundhed.example.test/api/v1"));
  const card = partPage("en", "medicationCard", input);
  assert.ok(card.includes("Testamol 500 mg"));
  assert.ok(card.includes("&lt;b&gt;Made up&lt;/b&gt;"));
  assert.ok(!card.includes("<b>Made up</b>"));
  const lab = partPage("da", "labResults", input);
  assert.ok(lab.includes("<svg"));
  assert.ok(lab.includes("uden for interval"));
  assert.ok(partPage("en", "referrals", input).includes("Not fetched"));
  assert.ok(!partPage("en", "labResults", { ...input, loggedIn: false }).includes("<form"));
});
