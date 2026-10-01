export const site = {
  /** The short name, for the logo, the footer and anywhere inline in a sentence. */
  name: "SplicR",
  /** The full name, for the document title, Open Graph and anywhere the
      product is being introduced rather than referred to. */
  fullName: "SplicR | CRISPR Screen Evidence",
  tagline: "Inspect the evidence behind your CRISPR hits.",
  description:
    "CRISPR screen analysis and prediction research with traceable evidence, measured benchmarks and explicit uncertainty.",
  email: "team@splicr.org",
  url: "https://splicr.org",
  /** The company's public location, used by the footer, the legal pages and
      every transactional email. Where SplicR started is history, not an address:
      that belongs to the About page and is written there, not sourced from here. */
  location: "New York, NY",
};

export const marketingNav = [
  { href: "/technology", label: "Technology" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/evidence", label: "Evidence" },
  { href: "/about", label: "About Us" },
] as const;

export const footerColumns = [
  {
    title: "Product",
    links: [
      { href: "/technology", label: "Tech" },
      { href: "/pipeline", label: "Pipeline" },
  { href: "/evidence", label: "Evidence" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/careers", label: "Careers" },
      { href: "/contact", label: "Contact" },
    ],
  },
] as const;
