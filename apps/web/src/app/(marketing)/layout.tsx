import { Footer } from "@/components/marketing/footer";
import { PageTransition } from "@/components/marketing/page-transition";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageTransition>{children}</PageTransition>
      <Footer />
    </>
  );
}
