import { Copy, KeyRound, Plus } from "lucide-react";

import { Card, PageHeader } from "@/components/dashboard/ui";

export const metadata = { title: "Connect" };

const keys = [
  { name: "Lab notebook agent", prefix: "spk_live_7f3a…", scopes: "atlas:read hits:read", created: "Sep 12, 2026", last: "2 h ago" },
  { name: "Biomni", prefix: "spk_live_c91e…", scopes: "atlas:read hits:read screens:write", created: "Aug 30, 2026", last: "yesterday" },
];

const mcpConfig = `{
  "mcpServers": {
    "splicr": {
      "type": "http",
      "url": "https://mcp.splicr.org/mcp",
      "headers": { "Authorization": "Bearer spk_live_..." }
    }
  }
}`;

const curl = `curl https://api.splicr.org/v1/screens/scr_demo/hits?min_chance=0.6 \\
  -H "Authorization: Bearer spk_live_..."`;

export default function ConnectPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Connect"
        title="They bring the chat, you bring the truth"
        body="A REST API and a remote MCP server so Claude, Biomni and GPT agents can look up SplicR scores and the Atlas mid-conversation."
        actions={
          <button className="btn btn-orange btn-sm">
            <Plus className="w-4 h-4" /> New API key
          </button>
        }
      />
      <div className="grid lg:grid-cols-2 gap-4">
        <Card title="API keys" subtitle="Scoped per organization. Rotate any time.">
          <ul className="divide-y divide-line">
            {keys.map((k) => (
              <li key={k.name} className="py-3 flex items-center justify-between gap-4 text-sm">
                <div className="flex items-center gap-3">
                  <span className="w-9 h-9 rounded-full bg-mist-soft flex items-center justify-center text-ink">
                    <KeyRound className="w-4 h-4" />
                  </span>
                  <div>
                    <div className="text-ink font-medium">{k.name}</div>
                    <div className="text-xs text-muted font-mono">{k.prefix}</div>
                  </div>
                </div>
                <div className="text-right text-xs text-muted">
                  <div>{k.scopes}</div>
                  <div>
                    created {k.created} · used {k.last}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Add SplicR to Claude Code" subtitle="Remote MCP over Streamable HTTP">
          <pre className="rounded-2xl bg-teal-950 text-white/90 text-xs p-4 overflow-x-auto thin-scroll">
            {`claude mcp add --transport http splicr https://mcp.splicr.org/mcp \\
  --header "Authorization: Bearer spk_live_..."`}
          </pre>
          <div className="mt-3 text-xs text-muted">Or paste this into .mcp.json:</div>
          <pre className="mt-2 rounded-2xl bg-teal-950 text-white/90 text-xs p-4 overflow-x-auto thin-scroll">{mcpConfig}</pre>
          <button className="mt-3 btn btn-ghost btn-sm">
            <Copy className="w-4 h-4" /> Copy
          </button>
        </Card>
        <Card title="REST" subtitle="Same data, plain HTTP">
          <pre className="rounded-2xl bg-teal-950 text-white/90 text-xs p-4 overflow-x-auto thin-scroll">{curl}</pre>
        </Card>
        <Card title="Tools exposed to agents">
          <ul className="text-sm divide-y divide-line">
            {[
              ["splicr.score_hits", "Score a gene list against a screen context"],
              ["splicr.gene_history", "A gene's hit history and validation record across the Atlas"],
              ["splicr.similar_screens", "Find public screens like the one described"],
              ["splicr.hit_report", "Fetch a finished Hit Report as structured JSON"],
              ["splicr.plan_screen", "Focused library and power estimate for a planned screen"],
            ].map(([n, d]) => (
              <li key={n} className="py-2.5">
                <div className="font-mono text-xs text-ink">{n}</div>
                <div className="text-muted text-xs">{d}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
