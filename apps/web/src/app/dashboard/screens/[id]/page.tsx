import { notFound } from "next/navigation";

import { ScreenWorkspace } from "@/components/dashboard/screen-workspace";
import { screens } from "@/lib/mock/data";

export default async function ScreenPage(props: PageProps<"/dashboard/screens/[id]">) {
  const { id } = await props.params;
  const sp = await props.searchParams;
  const screen = screens.find((s) => s.id === id);
  if (!screen) notFound();
  const tab = typeof sp.tab === "string" ? sp.tab : "overview";
  return <ScreenWorkspace screen={screen} tab={tab} />;
}
