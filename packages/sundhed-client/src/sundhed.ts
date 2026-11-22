// The sundhed.dk citizen endpoints, as the site's own pages call them.
// Mapped from the Min Side apps; only query values seen in real traffic are used.
// Everything here only reads, except requestRenewal at the end.
import { apiGet, apiPost } from "@sundhedmcp/session";
import { clean, isoDate } from "./data.ts";

const MEDICINKORT = "/app/medicinkort2borger/api/v1";
const VACCINATION = "/app/vaccination/api/v1";
const PROEVESVAR = "/app/proevesvarportal/api/v1";
const HENVISNING = "/app/DenNationaleHenvisningsformidling/api/v1";

/** One path segment. Refuses anything that is not a plain id, such as "..". */
export function id(value: string | number): string {
  const s = String(value);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(s)) throw new Error(`Not a valid id: ${JSON.stringify(s.slice(0, 80))}`);
  return s;
}
const get = async (path: string) => clean(await apiGet(path));

export async function summary() {
  const [medicine, prescriptions, vaccinations] = await Promise.all([
    apiGet(`${MEDICINKORT}/ordinations/overview/`),
    apiGet(`${MEDICINKORT}/prescriptions/overview/`),
    apiGet(`${VACCINATION}/overview`),
  ]);
  return clean({ medicine, prescriptions, vaccinations });
}

/** Current medicine on Fælles Medicinkort, newest first. */
export const medicationCard = () => get(`${MEDICINKORT}/ordinations/?orderBy=StartDate&sortBy=desc&status=active`);

export const medicationDetails = (ordinationId: string) => get(`${MEDICINKORT}/ordinations/${id(ordinationId)}/details`);

/** Open prescriptions tied to the medicine card. */
export const openPrescriptions = () => get(`${MEDICINKORT}/prescriptions/?connected=true&status=open`);

export const prescription = (prescriptionId: string) => get(`${MEDICINKORT}/prescriptions/${id(prescriptionId)}/`);

export const vaccinations = () =>
  get(`${VACCINATION}/effectuatedvaccinations/?onlyDeletedVaccines=false&orderBy=desc&sortBy=EffectuatedDateTime`);

/** A vaccination's newest registered version. Registrations can be corrected, which adds versions. */
export async function vaccination(vaccinationId: string) {
  const history = (await apiGet(`${VACCINATION}/effectuatedvaccinations/${id(vaccinationId)}/history`)) as { Id: number }[] | null;
  if (!history?.length) return null;
  const latest = Math.max(...history.map((h) => h.Id));
  return get(`${VACCINATION}/effectuatedvaccinations/${id(vaccinationId)}/history/${latest}`);
}

/** Regional lab results between two dates (inclusive). */
export function labResults(from: Date, to: Date) {
  const q = new URLSearchParams({
    fra: `${isoDate(from)}T00:00:00`,
    til: `${isoDate(to)}T23:59:59`,
    source: "RegionaleProevesvar",
    omraade: "Alle",
  });
  return get(`${PROEVESVAR}/svaroversigt?${q}`);
}

export const referrals = () => get(`${HENVISNING}/henvisninger`);

// --- Prescription renewal (receptfornyelse), as the medicine card's own "Forny recept" calls it ---

/**
 * The medicine that can be asked to be renewed, with HasDoctor (the person has
 * a GP to send it to) and MedicineCardVersion (sent back with a request).
 * Each row's Status: 0 can be renewed, 1 private-marked, 2 or 3 cannot be
 * renewed, 4 being handled, 6 dose-dispensed.
 */
export const renewable = () => apiGet(`${MEDICINKORT}/orderprescriptions/ordinations`);

/** Package sizes a renewal can ask for: Packages[] of { Varenummer, Tekst }, and DefaultPackageNumber. */
export const renewalPackages = (drugMedicationId: string) =>
  apiGet(`${MEDICINKORT}/renewprescription/drugpackages?${new URLSearchParams({ drugMedicationId: id(drugMedicationId) })}`);

/** Renewal requests sent earlier, with their status (Unprescribed, Prescribed, CancelledCitizen, CancelledHealthcare). */
export const renewalRequests = () => get(`${MEDICINKORT}/orderprescriptions/orders`);

/**
 * Sends a renewal request to the person's GP. This writes to sundhed.dk.
 * Pass the ids exactly as renewable() and renewalPackages() gave them (number
 * or string): the site's own page sends them unchanged.
 */
export function requestRenewal(r: { drugMedicationId: string | number; medicineCardVersion: unknown; packageNumber: string | number; quantity: number }) {
  id(r.drugMedicationId);
  id(r.packageNumber);
  return apiPost(`${MEDICINKORT}/orderprescriptions`, {
    DrugMedicationId: r.drugMedicationId,
    MedicineCardVersion: r.medicineCardVersion,
    PackageNumber: r.packageNumber,
    Quantity: r.quantity,
  });
}
