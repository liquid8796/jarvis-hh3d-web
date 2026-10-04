"use client";

import React from "react";
import Link from "next/link";
import { useLanguage } from "@/lib/i18n/context";
import { SectSeal } from "@/components/SectSeal";

export function LandingView() {
  const { t } = useLanguage();

  return (
    <>
      {/* Bảo hoa rơi — cánh hoa hồng phấn của Bảo Hoa tiên tử */}
      <div className="petals" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <i key={i} style={{ "--i": i } as React.CSSProperties} />
        ))}
      </div>

      <main className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6">
        {/* Hero Section */}
        <section className="rise-in flex flex-col items-center py-14 text-center">
          <SectSeal size="5.5rem" />
          <div className="hero-veil mt-8 flex flex-col items-center">
            <h1 className="h-display max-w-3xl text-3xl font-bold leading-tight sm:text-4xl md:text-5xl">
              {t.hero.headlinePre}
              <span className="text-gilded">{t.hero.headlineHighlight1}</span>
              {t.hero.headlineMid}
              <br />
              <span className="text-gilded">{t.hero.headlineHighlight2}</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-[var(--color-parchment)]/90">
              {t.hero.description}
            </p>
            <div className="mt-8 flex gap-4">
              <Link href="/register" className="btn btn-gold text-base">
                {t.hero.ctaPrimary}
              </Link>
              <Link href="/login" className="btn btn-ghost text-base">
                {t.hero.ctaSecondary}
              </Link>
            </div>
          </div>
        </section>

        {/* 3 Trụ cột cốt lõi */}
        <section aria-label="Core Pillars" className="grid gap-6 md:grid-cols-3">
          {t.pillars.map((p, i) => (
            <article
              key={p.title}
              className="card card-hairline rise-in p-6"
              style={{ animationDelay: `${0.12 * (i + 1)}s` }}
            >
              <h2 className="h-display mb-3 text-lg font-semibold text-gilded">{p.title}</h2>
              <p className="text-sm leading-relaxed text-[var(--color-mist)]">{p.body}</p>
            </article>
          ))}
        </section>

        {/* VỊ TRÍ QUẢNG CÁO ADSTERRA (CHUYỂN LÊN TRƯỚC BLOCK TÍNH NĂNG) */}
        <div
          id="landing-ad-placement"
          className="my-12 w-full flex justify-center items-center min-h-[90px]"
          aria-label="Sponsored placement"
        />

        {/* Tính năng linh đài chi tiết (Automated Artifacts) */}
        <section aria-labelledby="features-heading" className="mt-14">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--color-gold-300)]">
              {t.features.tag}
            </p>
            <h2 id="features-heading" className="h-display mt-2 text-2xl font-bold text-gilded sm:text-3xl">
              {t.features.heading}
            </h2>
            <p className="mt-3 max-w-2xl mx-auto text-sm leading-relaxed text-[var(--color-mist)]">
              {t.features.description}
            </p>
          </div>

          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {t.features.items.map((feature, idx) => (
              <article key={idx} className="card card-hairline p-6 flex flex-col justify-between">
                <div>
                  <h3 className="h-display text-base font-semibold text-gilded mb-2 flex items-center gap-2">
                    <span className="text-[var(--color-gold-300)]" aria-hidden="true">✦</span>
                    <span>{feature.title}</span>
                  </h3>
                  <p className="text-sm leading-relaxed text-[var(--color-mist)]">{feature.body}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 4 Bước nhập môn */}
        <section aria-labelledby="steps-heading" className="mt-20">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--color-gold-300)]">
              {t.steps.tag}
            </p>
            <h2 id="steps-heading" className="h-display mt-2 text-2xl font-bold text-gilded sm:text-3xl">
              {t.steps.heading}
            </h2>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.steps.items.map((step, idx) => (
              <div key={idx} className="card card-hairline p-5 relative">
                <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-gold-300)] mb-2">
                  {t.steps.stepPrefix} 0{idx + 1}
                </div>
                <h3 className="h-display text-base font-semibold text-gilded mb-2">{step.title}</h3>
                <p className="text-xs leading-relaxed text-[var(--color-mist)]">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Câu hỏi thường gặp (FAQ) */}
        <section aria-labelledby="faq-heading" className="mt-20">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[.18em] text-[var(--color-gold-300)]">
              {t.faq.tag}
            </p>
            <h2 id="faq-heading" className="h-display mt-2 text-2xl font-bold text-gilded sm:text-3xl">
              {t.faq.heading}
            </h2>
            <p className="mt-3 max-w-xl mx-auto text-sm leading-relaxed text-[var(--color-mist)]">
              {t.faq.description}
            </p>
          </div>

          <div className="mt-10 space-y-4 max-w-3xl mx-auto">
            {t.faq.items.map((faq, idx) => (
              <details
                key={idx}
                className="card card-hairline group rounded-xl p-5 open:bg-[rgba(31,27,55,0.7)] transition-colors"
                {...(idx === 0 ? { open: true } : {})}
              >
                <summary className="h-display cursor-pointer text-base font-semibold text-gilded list-none flex items-center justify-between gap-4">
                  <span>{faq.question}</span>
                  <span
                    className="text-xs text-[var(--color-gold-300)] transition-transform duration-200 group-open:rotate-180"
                    aria-hidden="true"
                  >
                    ▼
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-mist)] border-t border-[rgba(155,150,190,.14)] pt-3">
                  {faq.answer}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* Kêu gọi hành động */}
        <section className="mt-20 text-center">
          <div className="card card-hairline p-8 sm:p-12 max-w-2xl mx-auto bg-[linear-gradient(145deg,rgba(31,27,55,.8),rgba(12,10,26,.9))]">
            <h2 className="h-display text-2xl font-bold text-gilded sm:text-3xl">
              {t.cta.heading}
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-mist)]">
              {t.cta.description}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-4">
              <Link href="/register" className="btn btn-gold text-base">
                {t.cta.buttonRegister}
              </Link>
              <Link href="/quyen-rieng-tu" className="btn btn-ghost text-base">
                {t.cta.buttonPrivacy}
              </Link>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
