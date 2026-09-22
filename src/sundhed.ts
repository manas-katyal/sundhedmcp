// The sundhed.dk citizen endpoints, as the site's own pages call them.
// Mapped from the Min Side apps; only query values seen in real traffic are used.
import { apiGet } from "./session.ts";
import { clean, isoDate } from "./data.ts";

const MEDICINKORT = "/app/medicinkort2borger/api/v1";
const VACCINATION = "/app/vaccination/api/v1";
const PROEVESVAR = "/app/proevesvarportal/api/v1";
const HENVISNING = "/app/DenNationaleHenvisningsformidling/api/v1";

const id = (value: string | number) => encodeURIComponent(String(value));
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
