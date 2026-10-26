import { DOMAIN_CATALOG } from "@/lib/domains/catalog";

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.6 2.6 4 5.6 4 9s-1.4 6.4-4 9c-2.6-2.6-4-5.6-4-9s1.4-6.4 4-9Z" />
    </svg>
  );
}

export function DomainsPanel() {
  return (
    <section className="space-y-6" aria-labelledby="domains-heading">
      <div className="overflow-hidden rounded-2xl border border-[rgba(232,194,92,.2)] bg-[linear-gradient(145deg,rgba(31,27,55,.94),rgba(12,10,26,.97))] shadow-[0_24px_70px_rgba(0,0,0,.32)]">
        <div className="relative overflow-hidden border-b border-[rgba(155,150,190,.12)] px-5 py-6 sm:px-7">
          <div className="pointer-events-none absolute -left-20 -top-24 h-56 w-56 rounded-full bg-[rgba(150,120,240,.16)] blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-5">
            <div className="flex min-w-0 items-start gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-[rgba(232,194,92,.24)] bg-[rgba(232,194,92,.1)] text-[var(--color-gold-300)]">
                <GlobeIcon />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-[var(--color-gold-300)]">Danh bạ truy cập</p>
                <h1 id="domains-heading" className="h-display mt-1 text-2xl font-bold text-gilded">Tên miền</h1>
              </div>
            </div>
            <div className="rounded-xl border border-[rgba(126,224,184,.24)] bg-[rgba(33,109,81,.16)] px-4 py-3 text-right">
              <p className="text-[11px] font-bold uppercase tracking-[.12em] text-[#9ff2cf]">Trạng thái hệ thống</p>
              <p className="mt-1 text-sm font-semibold text-[var(--color-parchment)]">1 tên miền đang hoạt động</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 p-5 sm:p-7">
          {DOMAIN_CATALOG.map((domain) => (
              <article key={domain.hostname} className="relative overflow-hidden rounded-2xl border border-[rgba(126,224,184,.28)] bg-[linear-gradient(145deg,rgba(30,83,70,.25),rgba(7,6,15,.48))] p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[.12em] text-[var(--color-mist)]">{domain.title}</p>
                    <p className="mt-1 text-xs text-[var(--color-mist)]/75">{domain.role}</p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[rgba(33,109,81,.32)] px-3 py-1.5 text-xs font-bold text-[#9ff2cf]">
                    <i className="h-2 w-2 rounded-full bg-current" />
                    {domain.statusLabel}
                  </span>
                </div>
                <p className="mt-5 break-all font-mono text-base font-bold text-[#dff8ec] sm:text-lg">{domain.hostname}</p>
                <div className="mt-5 border-t border-[rgba(155,150,190,.12)] pt-4">
                  <a className="btn btn-gold w-full justify-center" href={domain.origin} target="_blank" rel="noreferrer">Mở tên miền chính thức ↗</a>
                </div>
              </article>
          ))}
        </div>
      </div>

    </section>
  );
}
