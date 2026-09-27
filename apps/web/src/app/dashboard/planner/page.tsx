import { Planner } from "@/components/dashboard/planner";

export const metadata = { title: "Screen Planner" };

/**
 * The page is the planner. Its own title line is inside the component, beside the
 * sample-data label, because the form and the figures it moves have to share one
 * screen and a 145px page header is four fields of the form.
 */
export default function PlannerPage() {
  return <Planner />;
}
