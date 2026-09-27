import { Card, PageHeader } from "@/components/dashboard/ui";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Settings" title="Workspace" />
      <div className="grid lg:grid-cols-2 gap-5">
        <Card title="Profile">
          <div className="space-y-5 text-sm">
            <div>
              <div className="label-sm">Name</div>
              <input className="underline-input" defaultValue="Demo user" />
            </div>
            <div>
              <div className="label-sm">Email</div>
              <input className="underline-input" defaultValue="demo@splicr.org" disabled />
            </div>
            <div>
              <div className="label-sm">ORCID</div>
              <input className="underline-input" placeholder="0000-0000-0000-0000" />
            </div>
            <button className="btn btn-teal btn-sm">Save</button>
          </div>
        </Card>

        <Card title="Organization" subtitle="Members share screens, outcomes and API keys">
          <div className="space-y-5 text-sm">
            <div>
              <div className="label-sm">Name</div>
              <input className="underline-input" defaultValue="Demo workspace" />
            </div>
            <div>
              <div className="label-sm">Plan</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="chip bg-cyan-50 text-cyan-700">Academic lab</span>
                <span className="text-muted text-xs">Free for public data with citation</span>
              </div>
            </div>
            <div>
              <div className="label-sm mb-2">Members</div>
              <ul className="divide-y divide-line">
                {[
                  ["Demo user", "Owner"],
                  ["R. Alvarez", "Member"],
                  ["M. Chen", "Member"],
                ].map(([n, r]) => (
                  <li key={n} className="py-2 flex justify-between">
                    <span className="text-ink">{n}</span>
                    <span className="text-muted">{r}</span>
                  </li>
                ))}
              </ul>
            </div>
            <button className="btn btn-ghost btn-sm">Invite member</button>
          </div>
        </Card>
      </div>
    </div>
  );
}
