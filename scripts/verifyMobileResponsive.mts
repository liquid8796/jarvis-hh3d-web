#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(name:string)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const header=read("src/components/SiteHeader.tsx");
const nav=read("src/components/SiteHeaderNav.tsx");
const global=read("src/app/globals.css");
const mobile=read("src/app/mobile.css");
const layout=read("src/app/layout.tsx");
const admin=read("src/app/admin/AdminTabs.tsx");
const quests=read("src/app/dashboard/QuestTimerPanel.tsx");
const account=read("src/app/dashboard/AccountManager.tsx");

assert(header.includes("site-header relative z-30"));
assert(header.includes("items-center justify-between") && !header.includes("flex-wrap items-center justify-between"),"mobile header must not wrap");
assert(nav.includes("xl:flex") && nav.includes("xl:hidden"),"tablet and phone must use compact nav");
assert(nav.includes('aria-expanded={open}') && nav.includes('aria-controls="mobile-site-navigation"'));
assert(nav.includes('event.key === "Escape"'),"escape closes mobile menu");
assert(nav.includes("document.addEventListener(\"pointerdown\", outside)"),"outside tap closes menu");
assert(nav.includes("setOpen(false)"),"route navigation closes drawer");
for(const route of ["/profile","/admin","/dashboard","/hang-doi","/chat","/login","/register"]) {
 assert(nav.includes('\"'+route+'\"'),"mobile nav must preserve "+route);
}
assert(mobile.includes("font-size: 16px"),"prevent mobile iOS input focus zoom");
assert(mobile.includes("min-height: 44px"),"touch target minimum");
assert(layout.includes('import "./mobile.css"'),"mobile layer must load last");
assert(global.includes("width: calc(100lvh * (1672 / 941))"),"preserve requested panorama pan");
assert(admin.includes("overflow-x-auto overscroll-x-contain"),"admin tabs must scroll locally");
assert(admin.includes("min-h-11 shrink-0 snap-start"),"admin tabs remain reachable and tappable");
assert(quests.includes("grid-cols-3 items-end gap-2"),"quest time fields must share a row on phones");
assert(quests.includes("col-span-3 min-w-0 sm:col-span-1"),"quest field adapts to full phone width");
assert(account.includes("<AccountWorkerAssignment account={account}"),"per-account worker choice retained");
assert(account.includes('min-[360px]:inline-flex'),"compact tiers must free space for checkboxes at 320px");
assert(account.includes('<span className="sm:hidden">{compactLabel}</span>') && account.includes('<span className="hidden sm:inline">{fullLabel}</span>'),"badge visibility must be applied to inner text, not unlayered .badge component");
const workerChoices = read("src/app/dashboard/AccountWorkerChoices.tsx");
assert(workerChoices.includes('ref={scrollRef}') && workerChoices.includes('rail.scrollLeft'),"selected checkbox must be scrolled into view on narrow phones");
assert(workerChoices.includes("b.width > a.width") && workerChoices.includes("rail.scrollLeft += b.left - a.left"),"wide chips must align at the start so the native checkbox remains visible");
assert(workerChoices.includes('overflow-x-auto whitespace-nowrap'),"choice chips remain on one line");
console.log("PASS responsive contract: header/menu, route parity, mobile inputs, admin tabs, timers, account choices, panorama.");
