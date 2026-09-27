/**
 * Connect: the workspace's API keys and the snippets that use them.
 *
 * Everything on this page is read from Postgres. `listApiKeys` is guarded by the
 * "admins read api keys" policy, so a member or a viewer gets an empty list and
 * the panel says why rather than pretending the workspace has no keys. A demo
 * visitor has no workspace at all, which the panel also says.
 */
import { ConnectPanel, type ConnectScreenOption } from "@/components/dashboard/connect-panel";
import { listConnectScreens, requestOrigin } from "@/lib/connect/data";
import { DEMO_API_KEYS } from "@/lib/connect/demo";
import { getCurrentContext, listApiKeys } from "@/lib/data/org";
import { roleAtLeast, type ApiKey } from "@/lib/data/types";

export const metadata = { title: "Connect" };

export default async function ConnectPage() {
  const { org, role, isDemo } = await getCurrentContext();

  const canManage = !isDemo && roleAtLeast(role, "admin");

  // A member or a viewer would get an empty list from RLS anyway. Skipping the
  // query keeps a page load from spending a round trip to be told no.
  const [keys, screens, origin] = await Promise.all([
    org && canManage ? listApiKeys(org.id) : Promise.resolve<ApiKey[]>([]),
    org ? listConnectScreens(org.id) : Promise.resolve([]),
    requestOrigin(),
  ]);

  const screenOptions: ConnectScreenOption[] = screens.map((screen) => ({
    id: screen.id,
    name: screen.name,
    n_hits: screen.n_hits,
  }));

  // A demo visitor has no workspace, so there is nothing real to list. Showing
  // the stand-in rows is more use than an empty table, as long as the card says
  // what they are, which it does.
  const keysAreDemo = isDemo && keys.length === 0;

  return (
    <ConnectPanel
      keys={keysAreDemo ? [...DEMO_API_KEYS] : keys}
      screens={screenOptions}
      origin={origin}
      orgName={org?.name ?? "this workspace"}
      role={role}
      canManage={canManage}
      isDemo={isDemo}
      keysAreDemo={keysAreDemo}
    />
  );
}
