export const site = {
  name: "SplicR",
  tagline: "Know which hits are real.",
  description:
    "The answer key for CRISPR screens. For every hit, a calibrated chance it is real, the reason, and what to do next.",
  email: "hello@splicr.org",
  url: "https://splicr.org",
  location: "New York, United States",
  founded: "Weill Cornell Medicine",
};

export const marketingNav = [
  { href: "/", label: "Homepage" },
  { href: "/technology", label: "Technology" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/about", label: "About Us" },
  { href: "/contact", label: "Contact Us" },
] as const;

export const footerColumns = [
  {
    title: "Product",
    links: [
      { href: "/technology", label: "Technology" },
      { href: "/pipeline", label: "Pipeline" },
      { href: "/dashboard", label: "Dashboard" },
      { href: "/login", label: "Sign in" },
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
