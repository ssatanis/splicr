import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";
import { marketingMetadata } from "@/lib/marketing-metadata";
import { site } from "@/lib/site";

export const metadata = marketingMetadata("/terms", {
  title: "Terms & Conditions",
  description: "The terms for using the SplicR website, workspace and hits API.",
});

const sections: LegalSection[] = [
  {
    id: "agreement",
    title: "Agreement",
    body: [
      `These terms govern your use of splicr.org, the SplicR workspace and the SplicR Connect hits API (together, the "Service"), operated by SplicR at ${site.location.replace(/\.$/, "")}. By using the Service you agree to them. If you use it for an organization, you confirm you can bind that organization.`,
      "If you have signed a separate pilot, evaluation or services agreement with us, that agreement controls wherever it differs from these terms.",
    ],
  },
  {
    id: "research-use",
    title: "Research use only",
    body: [
      "SplicR is a research tool. It is not a medical device, and nothing in the Service is medical, clinical, diagnostic or treatment advice. Do not use it to make decisions about the care of any person.",
      "Do not upload patient-identifiable or other personal health information.",
    ],
  },
  {
    id: "results",
    title: "What the results are and are not",
    body: [
      "SplicR reports statistics, quality-control checks, historical evidence and model-based rankings, together with the limits of each. The benchmarks we publish are retrospective replays. They are not prospective validation, and past performance on a benchmark does not promise the same result on your screen.",
      "A hit call, an FDR, a ranking or a score is a piece of evidence, not a finding that a gene has a given function. Confirm anything that matters with your own experiments before you rely on it or publish it. You are responsible for how you use the results.",
    ],
  },
  {
    id: "accounts",
    title: "Accounts and workspaces",
    body: [
      "- Give accurate information and keep your sign-in details and API keys private. You are responsible for activity under your account and keys.",
      "- Workspace administrators decide who joins their organization and what each member can see.",
      `- Tell us at ${site.email} right away if you think an account or key has been compromised.`,
      "Access to workspaces may be limited to invited organizations while parts of the Service are still being built.",
    ],
  },
  {
    id: "your-data",
    title: "Your data",
    body: [
      "You keep all rights in the screens, count tables, results and notes you put into the Service. You give us a limited licence to host, process and display them solely to provide the Service to you and your organization.",
      "We do not automatically train models on your data. Any reuse for research or model development requires your explicit permission, as described in our Privacy Policy.",
      "You confirm you have the right to upload what you upload, including any required approvals or data-use permissions for third-party or published data.",
    ],
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    body: [
      "Do not:",
      "- probe, scan or test the Service for vulnerabilities without our written permission, or bypass its access controls;",
      "- overload the Service or the hits API, or use it to build a competing product by scraping or bulk-copying it;",
      "- upload malware, or content that is unlawful or that you do not have the right to share;",
      "- share an API key outside your organization, or use the Service to harm others.",
      "We may suspend access that puts the Service or other users at risk.",
    ],
  },
  {
    id: "ip",
    title: "Our materials",
    body: [
      "The SplicR name, site, software, methods, documentation and published evidence are ours or our licensors'. These terms give you a right to use the Service, not to own or copy it. Published third-party datasets and tools referenced in the Service, such as BioGRID ORCS, MAGeCK, BAGEL2 and DrugZ, remain under their own licences and citation requirements.",
      "If you send us feedback, we may use it to improve the Service without owing you anything for it.",
    ],
  },
  {
    id: "warranty",
    title: "No warranty",
    body: [
      'The Service is provided "as is" and "as available". To the fullest extent the law allows, we do not promise that it will be uninterrupted or error-free, or that any result, prediction or analysis is accurate, complete or fit for a particular purpose.',
    ],
  },
  {
    id: "liability",
    title: "Limits on liability",
    body: [
      "To the fullest extent the law allows, SplicR and the people behind it are not liable for indirect, incidental, special or consequential damages, or for lost data, lost profits or wasted experiments, arising from your use of the Service. Our total liability for any claim is limited to the amount you paid us for the Service in the twelve months before the claim, or one hundred US dollars if you paid nothing.",
      "Nothing in these terms limits liability that cannot be limited by law.",
    ],
  },
  {
    id: "ending",
    title: "Ending your use",
    body: [
      `You can stop using the Service at any time and ask us to close your account at ${site.email}. We may suspend or end access if these terms are broken or the law requires it. Sections that by their nature should survive, such as ownership, warranty and liability, will.`,
    ],
  },
  {
    id: "law",
    title: "Governing law",
    body: [
      "These terms are governed by the laws of the State of New York, without regard to conflict-of-law rules. Courts located in New York State have exclusive jurisdiction over disputes, unless the law where you live gives you the right to bring a claim elsewhere.",
    ],
  },
  {
    id: "changes",
    title: "Changes",
    body: [
      "We may update these terms as the Service develops. We will change the date above and, for material changes, tell signed-in users by email. Using the Service after a change means you accept it.",
    ],
  },
  {
    id: "contact",
    title: "Contact",
    body: [`Questions about these terms: ${site.email}, ${site.location.replace(/\.$/, "")}.`],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms & Conditions"
      updated="September 29, 2026"
      intro="These are the ground rules for using SplicR. The short version: it is a research tool, your data stays yours, and its results are evidence to check, not answers to trust blindly."
      sections={sections}
      other={{ href: "/privacy", label: "Privacy Policy" }}
    />
  );
}
