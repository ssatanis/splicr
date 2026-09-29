import type { Metadata } from "next";

import { site } from "@/lib/site";

type PublicRoute = "/" | "/technology" | "/pipeline" | "/evidence" | "/about" | "/careers" | "/contact";

/** Keep each public page's search and sharing metadata on the same canonical URL. */
export function marketingMetadata(
  route: PublicRoute,
  { title, description }: { title: string; description: string },
): Metadata {
  const url = new URL(route, site.url).toString();
  const shareTitle = route === "/" ? site.fullName : `${title} | ${site.name}`;
  return {
    title: route === "/" ? { absolute: title } : title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: shareTitle,
      description,
      url,
      siteName: site.name,
      type: "website",
    },
    twitter: { card: "summary_large_image", title: shareTitle, description },
  };
}
