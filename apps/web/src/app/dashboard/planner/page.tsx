/**
 * Screen Planner: design arithmetic for a pooled CRISPR screen.
 *
 * It needs no workspace and reads no record, so it is the same for a demo
 * visitor and a signed-in member. The design lives in the address: the server
 * reads it here, clamps anything out of range, and hands the client a valid
 * starting point, so a shared link opens exactly as it was sent and a hand-edited
 * one cannot break the page.
 */
import { Planner } from "@/components/dashboard/planner";
import { paramsToRaw, sanitizeInputs } from "@/lib/planner/model";

export const metadata = { title: "Screen Planner" };

export default async function PlannerPage(props: PageProps<"/dashboard/planner">) {
  const { inputs } = sanitizeInputs(paramsToRaw(await props.searchParams));
  return <Planner initial={inputs} />;
}
