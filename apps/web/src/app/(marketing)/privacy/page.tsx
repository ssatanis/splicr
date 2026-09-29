import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { site } from "@/lib/site";

export const metadata = marketingMetadata("/privacy", {
  title: "Privacy Policy",
  description: "What SplicR collects when you visit the site, request a demo or use a workspace, and what we do with it.",
});

const sections: LegalSection[] = [
  {
    id: "who",
    title: "Who we are",
    body: [
      `SplicR ("SplicR", "we", "us") builds CRISPR screen analysis and evidence tools. We are based at ${site.location.replace(/\.$/, "")}. This policy covers splicr.org, the request-a-demo form and the SplicR workspace you reach after signing in.`,
      `For anything about your data, write to ${site.email}. A person reads it.`,
    ],
  },
  {
    id: "collect",
    title: "What we collect",
    body: [
      "We collect only what a feature needs, and it falls into four groups.",
      "- Demo and contact requests: your name, email address, lab or company, the topic you pick and any message you write. This arrives by email and is not copied into a database.",
      "- Account details: your email address, name, the workspace you belong to and your role in it, plus a password if you set one. If you sign in with Google, Google tells us your email and name; we do not receive your Google password.",
      "- Workspace content: the screens, count tables, sample roles, contrasts, hit calls, validation outcomes and notes you or your teammates add, and the API keys you create for the hits API. An API key is stored only as a one-way hash, so we cannot read it back.",
      "- Technical data: your IP address, browser type and the pages requested, which our hosting provider records in server logs to keep the site running and secure.",
      "We do not ask for financial details, government identifiers or patient data, and you should not put patient-identifiable information into a workspace.",
    ],
  },
  {
    id: "use",
    title: "How we use it",
    body: [
      "- To answer your demo request and to run the evaluation, pilot or workspace you ask for.",
      "- To sign you in, keep your session secure, and show each person only the workspaces they belong to.",
      "- To send messages about your request or account, such as the confirmation after the demo form, an invitation to a workspace, or a sign-in link.",
      "- To keep the service secure, find faults and prevent abuse.",
      "- To meet legal obligations.",
      "We do not sell personal information, and we do not use it for advertising.",
    ],
  },
  {
    id: "research",
    title: "Your screen data and model training",
    body: [
      "Data you upload or record in a workspace is yours. Workspace records are scoped to the organization that owns them, and other customers cannot read them.",
      "SplicR does not automatically train or retrain any model on customer screens or validation outcomes. If we ever want to reuse customer data for research or model development, we will ask for your explicit written permission first, and you can say no without losing access.",
    ],
  },
  {
    id: "providers",
    title: "Who else handles your data",
    body: [
      "We use a small number of service providers to run SplicR. Each acts on our instructions and only for the purpose listed.",
      "- Vercel hosts the website and its server code.",
      "- Supabase provides the database, sign-in and workspace storage.",
      "- Resend delivers the emails described above.",
      "- Google, only if you choose Google sign-in.",
      "Some of these providers process data in the United States. Beyond them, we share personal information only if the law requires it, if you ask us to, or as part of a merger or sale of the project, in which case we will tell you first.",
    ],
  },
  {
    id: "cookies",
    title: "Cookies",
    body: [
      "SplicR sets cookies only to keep you signed in and to protect your session. They are needed for the workspace to function. The public pages do not use advertising cookies or third-party analytics. If that changes, we will update this page and ask where the law requires it.",
    ],
  },
  {
    id: "retention",
    title: "How long we keep it",
    body: [
      "Demo request emails are kept for as long as we are in conversation with you and for a reasonable period afterwards. Account and workspace data is kept while your account or organization is active. When a workspace is closed or you ask us to delete it, we remove its records from our systems, and copies in backups expire on the provider's normal cycle. Server logs are kept for a short period set by our hosting provider.",
    ],
  },
  {
    id: "rights",
    title: "Your choices and rights",
    body: [
      `You can ask us to access, correct, export or delete the personal information we hold about you, to stop contacting you, or to close your account, by emailing ${site.email}. We will reply within 30 days.`,
      "Depending on where you live, including the European Economic Area, the United Kingdom and California, you may also have the right to object to or restrict certain processing and to complain to your local data protection authority. We will not treat you differently for using these rights.",
    ],
  },
  {
    id: "security",
    title: "Security",
    body: [
      "Access to workspace records is restricted by organization and role at the database level, API keys are stored as hashes, and connections to splicr.org are encrypted. No system is perfectly secure. If we learn of a breach that affects your information, we will tell you promptly and as the law requires.",
    ],
  },
  {
    id: "children",
    title: "Children",
    body: ["SplicR is a research tool for professionals and is not directed to children under 16. We do not knowingly collect their information."],
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: [
      `If we change this policy in a way that matters, we will update the date above and, for signed-in users, tell you by email. Questions are welcome at ${site.email}.`,
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="September 29, 2026"
      intro="SplicR is built by researchers, and we treat your screen data the way we would want ours treated. This page explains, in plain terms, what we collect, why, and the choices you have."
      sections={sections}
      other={{ href: "/terms", label: "Terms & Conditions" }}
    />
  );
}
