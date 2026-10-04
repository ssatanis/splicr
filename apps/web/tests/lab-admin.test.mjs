/**
 * Who runs a lab, what the lab's logo is, and what the lab has used.
 *
 * Three claims are load bearing here and each one is pinned:
 *
 *  - Only an admin or an owner can invite somebody or change a role. A
 *    researcher cannot, and is told so rather than failing silently.
 *  - A lab logo is a file this application stores. It is accepted on its bytes
 *    rather than on the content type a browser declared, and exactly two
 *    actions write the column so that the column and the object cannot drift.
 *  - Usage belongs to the lab. A plan is a column on the organization and on
 *    nothing else, so the panel reports one plan rather than implying a plan
 *    per person, and it never prints an allowance nothing enforces.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTs } from "./helpers/load-ts.mjs";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const USER = "00000000-0000-4000-8000-0000000000c1";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");

const ACTIONS = read("src/lib/data/actions.ts");
const USAGE_PANEL = read("src/components/dashboard/settings/usage-panel.tsx");
const LOGO_FIELD = read("src/components/dashboard/settings/logo-field.tsx");
const LAB_PANEL = read("src/components/dashboard/settings/lab-panel.tsx");
const ONBOARDING = read("src/app/dashboard/onboarding/page.tsx");
const MIGRATION = readFileSync(
  path.join(root, "../../supabase/migrations/20261004000100_lab_logo_and_usage.sql"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeClient({ handler, storage } = {}) {
  const queries = [];
  const client = {
    from(table) {
      const q = { table, op: "select", filters: [], payload: null, columns: null };
      queries.push(q);
      const chain = new Proxy(
        {},
        {
          get(_, method) {
            if (method === "then") {
              return (resolve, reject) => Promise.resolve(handler(q)).then(resolve, reject);
            }
            return (...args) => {
              if (method === "select") q.columns = args[0];
              else if (method === "insert" || method === "update") {
                q.op = method;
                q.payload = args[0];
              } else if (method !== "single" && method !== "maybeSingle") {
                q.filters.push([method, ...args]);
              }
              return chain;
            };
          },
        },
      );
      return chain;
    },
    storage: {
      from(bucket) {
        return {
          upload: async (objectPath, file, options) => {
            storage.uploads.push({ bucket, path: objectPath, file, options });
            return storage.uploadError ? { error: storage.uploadError } : { error: null };
          },
          getPublicUrl: (objectPath) => ({
            data: { publicUrl: `https://store.example/${bucket}/${objectPath}` },
          }),
          list: async (prefix) => ({
            data: storage.existing.map((name) => ({ name })),
            error: null,
            prefix,
          }),
          remove: async (paths) => {
            storage.removed.push(...paths);
            return { error: null };
          },
        };
      },
    },
  };
  return { client, queries };
}

function harness({ role = "admin", context, handler, storage } = {}) {
  const store = storage ?? { uploads: [], removed: [], existing: [], uploadError: null };
  const { client, queries } = makeClient({
    handler: handler ?? ((q) => (q.op === "update" ? { data: [{ id: ORG }], error: null } : { data: null, error: null })),
    storage: store,
  });
  const mod = loadTs("lib/data/actions.ts", {
    mocks: {
      "server-only": {},
      "next/cache": { revalidatePath() {} },
      "./org": {
        getCurrentContext: async () =>
          context ?? {
            isDemo: false,
            user: { id: USER, email: "a@b.c" },
            org: { id: ORG, name: "Franklin Lab", slug: "franklin" },
            role,
          },
        getOrgRole: async () => role,
        countOrgOwners: async () => 2,
        getOrgSettings: async () => ({}),
        listMembers: async () => [],
      },
      "@/lib/supabase/server": { createClient: async () => client },
      "@/lib/auth/invitations": { deliverWorkspaceInvite: async () => ({ state: "sent", error: null }) },
    },
  });
  return { ...mod, queries, storage: store };
}

/** A real PNG, a real JPEG, and a file lying about what it is. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

const asFile = (bytes, name, type) => new File([bytes], name, { type });

function logoForm(file) {
  const body = new FormData();
  body.set("logo", file);
  return body;
}

// ---------------------------------------------------------------------------
// Only admins invite
// ---------------------------------------------------------------------------

test("a researcher cannot invite anybody, and is told which role is needed", async () => {
  for (const role of ["viewer", "member"]) {
    const app = harness({ role });
    const result = await app.inviteMember("new@lab.example", "member");
    assert.equal(result.ok, false, role);
    assert.match(result.error, /need the admin role/i);
    assert.equal(app.queries.length, 0, `${role} touched no table`);
  }
});

test("a researcher cannot change a role or remove anybody", async () => {
  const app = harness({ role: "member" });
  assert.equal((await app.changeMemberRole(USER, "admin")).ok, false);
  assert.equal((await app.inviteMember("x@lab.example", "admin")).ok, false);
  assert.equal(app.queries.length, 0);
});

test("an admin cannot hand out a role above their own", async () => {
  const app = harness({ role: "admin" });
  const result = await app.inviteMember("pi@lab.example", "owner");
  assert.equal(result.ok, false);
  assert.match(result.error, /cannot invite somebody as owner/i);
});

test("the role legend holds the longest label, and is a pill rather than an oval", () => {
  const legend = read("src/components/dashboard/members/role-legend.tsx");
  const chip = legend.match(/"mt-0\.5 inline-flex[^"]+"/)?.[0] ?? "";
  // w-16 fitted "Viewer" and broke on "Researcher"; a stretched flex child
  // became an oval as tall as the sentence beside it.
  assert.ok(!/\bw-16\b/.test(chip), "the fixed width is not sized to the shortest label");
  assert.match(chip, /self-start/, "the pill does not stretch to the row");
  assert.match(chip, /whitespace-nowrap/, "and the label does not wrap inside it");
});

test("the roles on offer are named the way the console names them", () => {
  const types = read("src/lib/data/types.ts");
  assert.match(types, /member: "Researcher"/, "member reads as researcher on screen");
  // The database enum is untouched, because policies and invite rows compare
  // against it. Renaming it would be a migration with nothing to show for it.
  assert.match(types, /ORG_ROLES = \["owner", "admin", "member", "viewer"\]/);
  assert.match(ACTIONS, /Pick one of owner, admin, researcher or viewer/);
});

// ---------------------------------------------------------------------------
// The lab logo
// ---------------------------------------------------------------------------

test("a PNG is accepted, stored under the organization id, and becomes the logo", async () => {
  const app = harness();
  const result = await app.uploadLabLogo(logoForm(asFile(PNG, "crest.png", "image/png")));
  assert.equal(result.ok, true);

  const [upload] = app.storage.uploads;
  assert.equal(upload.bucket, "lab-logos");
  assert.match(upload.path, new RegExp(`^${ORG}/logo-[a-z0-9]+-[0-9a-f]{8}\\.png$`));
  assert.equal(upload.options.contentType, "image/png");
  assert.equal(upload.options.upsert, false, "a new object, never an overwrite");

  const update = app.queries.find((q) => q.op === "update");
  assert.equal(update.table, "organizations");
  assert.equal(update.payload.logo_url, `https://store.example/lab-logos/${upload.path}`);
  assert.deepEqual(
    update.filters.find((f) => f[0] === "eq"),
    ["eq", "id", ORG],
    "the organization comes from the session",
  );
});

test("a file is judged on its bytes, not on what it says it is", async () => {
  // An SVG renamed and relabelled as a PNG. The bucket is world readable and
  // an SVG is a script container, so the declared type is not evidence.
  const liar = harness();
  const refused = await liar.uploadLabLogo(logoForm(asFile(SVG, "crest.png", "image/png")));
  assert.equal(refused.ok, false);
  assert.match(refused.error, /PNG, JPEG or WebP/);
  assert.equal(liar.storage.uploads.length, 0, "nothing was stored");

  // And a real JPEG mislabelled as a PNG is refused too: the magic bytes and
  // the declared type have to agree before anything is written.
  const mismatched = harness();
  assert.equal(
    (await mismatched.uploadLabLogo(logoForm(asFile(JPEG, "crest.png", "image/png")))).ok,
    false,
  );
  assert.equal(mismatched.storage.uploads.length, 0);

  // The same JPEG, honestly labelled, goes through.
  const honest = harness();
  assert.equal((await honest.uploadLabLogo(logoForm(asFile(JPEG, "crest.jpg", "image/jpeg")))).ok, true);
  assert.match(honest.storage.uploads[0].path, /\.jpg$/);
});

test("an oversized image is refused before it is read or uploaded", async () => {
  const app = harness();
  const huge = asFile(Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]), "big.png", "image/png");
  const result = await app.uploadLabLogo(logoForm(huge));
  assert.equal(result.ok, false);
  assert.match(result.error, /larger than 2 MB/);
  assert.equal(app.storage.uploads.length, 0);
});

test("a stored object with no row pointing at it is removed again", async () => {
  const app = harness({
    handler: (q) => (q.op === "update" ? { data: [], error: null } : { data: null, error: null }),
  });
  const result = await app.uploadLabLogo(logoForm(asFile(PNG, "crest.png", "image/png")));
  assert.equal(result.ok, false);
  assert.deepEqual(app.storage.removed, [app.storage.uploads[0].path], "the orphan is cleaned up");
});

test("the previous logo is deleted once the new one is the lab's", async () => {
  const app = harness({
    storage: { uploads: [], removed: [], existing: ["logo-old-11111111.png"], uploadError: null },
  });
  await app.uploadLabLogo(logoForm(asFile(PNG, "crest.png", "image/png")));
  assert.deepEqual(app.storage.removed, [`${ORG}/logo-old-11111111.png`]);
  assert.equal(
    app.storage.removed.includes(app.storage.uploads[0].path),
    false,
    "the one just uploaded is kept",
  );
});

test("removing the logo clears the column and deletes every file behind it", async () => {
  const app = harness({
    storage: { uploads: [], removed: [], existing: ["logo-a.png", "logo-b.webp"], uploadError: null },
  });
  const result = await app.removeLabLogo();
  assert.equal(result.ok, true);
  assert.equal(app.queries.find((q) => q.op === "update").payload.logo_url, null);
  assert.deepEqual(app.storage.removed, [`${ORG}/logo-a.png`, `${ORG}/logo-b.webp`]);
});

test("a researcher cannot change the lab logo", async () => {
  for (const role of ["viewer", "member"]) {
    const app = harness({ role });
    assert.equal((await app.uploadLabLogo(logoForm(asFile(PNG, "c.png", "image/png")))).ok, false);
    assert.equal((await app.removeLabLogo()).ok, false);
    assert.equal(app.storage.uploads.length, 0);
    assert.equal(app.storage.removed.length, 0);
  }
});

test("exactly two actions write logo_url, so the column and the object stay together", async () => {
  // The generic organization form used to write it as well. Two writers for
  // one column, one of which also owns a file, is how the two drift apart.
  const writers = ACTIONS.split("\n").filter((line) => /logo_url:/.test(line));
  assert.equal(writers.length, 2, `logo_url is assigned in ${writers.length} places`);
  assert.ok(/uploadLabLogo/.test(ACTIONS) && /removeLabLogo/.test(ACTIONS));
  assert.ok(
    !/\["logo_url", 2048\]/.test(ACTIONS),
    "updateOrganization no longer takes a pasted URL",
  );
  const onboarding = read("src/app/dashboard/onboarding/actions.ts");
  assert.ok(!/logo_url: parsed/.test(onboarding), "nor does the onboarding step");
});

test("the upload is offered in onboarding and again in settings, and is never required", () => {
  assert.match(ONBOARDING, /<LabLogoField/, "onboarding offers it");
  assert.match(ONBOARDING, /Optional\. You can add or change it later in Settings/);
  assert.match(LAB_PANEL, /<LabLogoField/, "settings offers it too");
  // The field is not inside the panel's form: forms do not nest, and the lab's
  // other fields must not post several megabytes of PNG on every save.
  const field = LAB_PANEL.slice(LAB_PANEL.indexOf("<LabLogoField"));
  assert.ok(field.indexOf("<PanelForm") > 0, "the logo sits above the form, not inside it");
  // Comments stripped first: the file explains at length why it is not a form.
  const code = LOGO_FIELD.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.ok(!/<form[\s>]/.test(code), "and is not a form of its own");
});

test("the bucket refuses by size and by type in the database as well", () => {
  assert.match(MIGRATION, /'lab-logos'/);
  assert.match(MIGRATION, /2097152/, "2 MB, the same number the action checks");
  assert.match(MIGRATION, /array\['image\/png', 'image\/jpeg', 'image\/webp'\]/);
  assert.ok(!/image\/svg/.test(MIGRATION), "no SVG in a world-readable bucket");
  // Writes are admin-only and scoped to the organization in the object path.
  for (const verb of ["insert", "update", "delete"]) {
    const policy = MIGRATION.slice(MIGRATION.indexOf(`for ${verb} to authenticated`));
    assert.match(
      policy.slice(0, 260),
      /private\.has_org_role\(private\.storage_org_id\(name\), 'admin'\)/,
    );
  }
});

// ---------------------------------------------------------------------------
// Usage belongs to the lab
// ---------------------------------------------------------------------------

function usage({ data, error = null } = {}) {
  const calls = [];
  const mod = loadTs("lib/data/usage.ts", {
    mocks: {
      "server-only": {},
      "@/lib/supabase/server": {
        createClient: async () => ({
          rpc: async (name, args) => {
            calls.push({ name, args });
            return { data, error };
          },
        }),
      },
    },
  });
  return { ...mod, calls };
}

const FULL = {
  org_id: ORG,
  plan: "lab",
  people: [
    {
      user_id: USER,
      name: "R. Franklin",
      email: "rf@lab.example",
      role: "owner",
      screens: 3,
      runs: 5,
      runs_30d: 2,
      outcomes: 4,
      api_keys: 1,
      last_active_at: "2026-10-01T00:00:00Z",
      joined_at: "2026-01-02T00:00:00Z",
    },
  ],
  totals: {
    screens: 4,
    runs: 5,
    runs_30d: 2,
    outcomes: 4,
    api_keys: 1,
    members: 2,
    pending_invites: 1,
  },
  unattributed: { screens: 1, runs: 0, outcomes: 0, api_keys: 0 },
};

test("usage is one call for the whole lab, not one per person", async () => {
  const app = usage({ data: FULL });
  const view = await app.getOrgUsage(ORG);
  assert.equal(app.calls.length, 1);
  assert.deepEqual(app.calls[0], { name: "org_usage", args: { p_org: ORG } });
  assert.equal(view.status, "ready");
  assert.equal(view.plan, "lab");
  assert.equal(view.people[0].runs30d, 2);
});

test("a failed read is never shown as a lab that has done nothing", async () => {
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal((await usage({ error: { message: "down" } }).getOrgUsage(ORG)).status, "unavailable");
    assert.equal((await usage({ data: null }).getOrgUsage(ORG)).status, "unavailable");
  } finally {
    console.error = quiet;
  }
  assert.equal((await usage({ data: FULL }).getOrgUsage(null)).status, "no-workspace");

  // An empty lab is a different answer, and says so with zeros.
  const empty = await usage({
    data: { plan: "free", people: [], totals: {}, unattributed: {} },
  }).getOrgUsage(ORG);
  assert.equal(empty.status, "ready");
  assert.deepEqual(empty.totals, {
    screens: 0,
    runs: 0,
    runs30d: 0,
    outcomes: 0,
    apiKeys: 0,
    members: 0,
    pendingInvites: 0,
  });
});

test("an unreadable role is read down to viewer, never up", async () => {
  const view = await usage({
    data: { ...FULL, people: [{ ...FULL.people[0], role: "superuser" }] },
  }).getOrgUsage(ORG);
  assert.equal(view.people[0].role, "viewer");
});

test("the per-person rows and the lab total are made to agree, in the open", () => {
  // The function returns what nobody in the lab can be credited with rather
  // than hiding the difference, and the panel prints it when it is not zero.
  assert.match(MIGRATION, /'unattributed',/);
  assert.match(USAGE_PANEL, /spareTotal > 0/);
  assert.match(USAGE_PANEL, /It is counted in the lab\s*\n?\s*totals above and in no row below them\./);
});

test("the panel states one plan for the lab and invents no allowance", () => {
  assert.match(USAGE_PANEL, /carried by \{lab\} on the \{PLAN_LABEL\[plan\]\} plan/);
  assert.match(USAGE_PANEL, /do not get a workspace\s*\n?\s*or a plan of their own/);
  // Nothing meters or charges anything yet, so nothing counts down from a
  // limit. A seat allowance on this page would be a number with no enforcement
  // anywhere behind it.
  for (const invention of [/\bof \d+ seats\b/, /\bremaining\b/, /\bquota\b/i, /\bincluded\b/i]) {
    assert.ok(!invention.test(USAGE_PANEL), `the panel must not claim ${invention}`);
  }
});

test("usage is gated on membership in the database, not in the page", () => {
  assert.match(MIGRATION, /security definer/);
  assert.match(
    MIGRATION,
    /if p_org is null or not private\.is_org_member\(p_org\) then\s*\n\s*raise exception/,
  );
  assert.match(MIGRATION, /revoke all on function public\.org_usage\(uuid\) from public, anon;/);
});
