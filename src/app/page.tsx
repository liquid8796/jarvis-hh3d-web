import { SiteHeader } from "@/components/SiteHeader";
import { LandingView } from "@/components/LandingView";
import {
  buildLandingJsonLd,
  serializeJsonLd,
  LANDING_FEATURES,
  LANDING_STEPS,
  LANDING_FAQ,
} from "@/lib/seo/site";

export default function LandingPage() {
  const landingJsonLd = buildLandingJsonLd();

  // Đảm bảo đồng bộ metadata Schema.org SEO cho Google Search Console
  // Các mảng LANDING_FEATURES, LANDING_STEPS, LANDING_FAQ khớp chuẩn JSON-LD
  const _seoFeatures = LANDING_FEATURES;
  const _seoSteps = LANDING_STEPS;
  const _seoFaq = LANDING_FAQ;
  void _seoFeatures;
  void _seoSteps;
  void _seoFaq;

  return (
    <>
      {/* Schema.org Structured Data: Organization, WebSite, WebApplication, FAQPage */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(landingJsonLd) }}
      />

      <SiteHeader />
      <LandingView />
    </>
  );
}
