"use client";

import { type ReactNode } from "react";

/* ── Section layout ───────────────────────────── */
export function BentoCard({
  tag,
  title,
  desc,
  mock,
  id,
}: {
  tag: string;
  title: string;
  desc: string;
  mock: ReactNode;
  id?: string;
}) {
  return (
    <article className="bento-card" id={id}>
      <div className="bento-visual">{mock}</div>
      <div className="bento-body">
        <span className="feat-tag">{tag}</span>
        <h2 className="bento-title">{title}</h2>
        <p className="bento-desc">{desc}</p>
      </div>
    </article>
  );
}

/* ── 1. The visibility scan — where you stand in AI answers ── */
const SCAN: Array<{ hit: boolean; q: string; who: string }> = [
  { hit: false, q: "best crm for a small startup", who: "Salesforce · HubSpot · Pipedrive" },
  { hit: false, q: "affordable crm software", who: "Zoho · Monday · Freshsales" },
  { hit: false, q: "crm for a 5-person team", who: "HubSpot · Notion · Zoho" },
  { hit: true, q: "crm with the fastest support", who: "you · #2" },
];
export function ScanMock() {
  return (
    <div className="mk mk-screen">
      <div className="mk-bar">
        <span className="d r" />
        <span className="d y" />
        <span className="d g" />
        <span className="mk-url">chatgpt.com · live search</span>
      </div>
      <div className="mk-log">
        {SCAN.map((s, i) => (
          <div key={i} className={`mk-line${s.hit ? " ok" : ""}`}>
            <span className={s.hit ? "mk-ok" : "mk-verb"}>{s.hit ? "you ▸" : "  —  "}</span>{" "}
            {s.q}
            <div className="mk-sub2">{s.hit ? `ranked ${s.who}` : `winners: ${s.who}`}</div>
          </div>
        ))}
        <div className="mk-line ok">
          <span className="mk-ok">✓</span> 20 AI searches · you show up on 4
        </div>
      </div>
    </div>
  );
}

/* ── 2. The agent fixes it, then verifies ── */
const FIX: Array<[string, string]> = [
  ["pigeon ▸", "gap: “cost to hire a copywriter” · ~10k/mo · no strong rival"],
  ["pigeon ▸", "wrote answer-first guide + FAQPage schema"],
  ["pigeon ▸", "re-measured that exact search…"],
  ["✓", "you now show up · kept, verified, remembered"],
];
export function FixMock() {
  return (
    <div className="mk mk-screen">
      <div className="mk-bar">
        <span className="d r" />
        <span className="d y" />
        <span className="d g" />
        <span className="mk-url">pigeon · autonomous run</span>
      </div>
      <div className="mk-log">
        {FIX.map(([v, t], i) => (
          <div key={i} className={`mk-line${v === "✓" ? " ok" : ""}`}>
            <span className={v === "✓" ? "mk-ok" : "mk-verb"}>{v}</span> {t}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── 3. Whitespace — winnable, high-demand gaps ── */
const WHITE: Array<[string, string]> = [
  ["cost to hire a copywriter", "~10k/mo"],
  ["how to match a freelancer to my brand", "~2k/mo"],
  ["emergency graphic designer, same day", "~1k/mo"],
];
export function WhitespaceMock() {
  return (
    <div className="mk mk-panel">
      <div className="mk-head">
        <span>quick-win whitespace</span>
        <span className="mk-sig">no strong rival · by demand</span>
      </div>
      <div className="mk-rows">
        {WHITE.map(([q, vol], i) => (
          <div key={i} className="mk-row">
            <span className="mk-act">○</span>
            <span className="mk-tgt">{q}</span>
            <span className="pill approved">{vol}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
