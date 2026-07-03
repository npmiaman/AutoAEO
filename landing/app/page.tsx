"use client";

import { BentoCard, ScanMock, FixMock, WhitespaceMock } from "./mocks";
import { EnginesBentoCard } from "./PlatformLogos";
import GetStartedCard from "./GetStartedCard";
import Faqs from "./Faqs";
import ProblemScroll from "./ProblemScroll";
import ContactPopup from "./ContactPopup";
import PixelPigeon from "./PixelPigeon";
import { useEffect, useState } from "react";

const SIGNUP_URL = process.env.NEXT_PUBLIC_SIGNUP_URL ?? "https://app.pigeon.dev/signup";
const CONTACT_EMAIL = "hello@pigeon.dev";

function Brand() {
  return (
    <>
      <span className="brand-br">[</span>P<span className="brand-br">]</span>igeon
    </>
  );
}

export default function Home() {
  const [scrolled, setScrolled] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="landing">
      <nav className={`nav${scrolled ? " scrolled" : ""}`}>
        <a className="brand" href="#top">
          <PixelPigeon size={26} />
          <span><Brand /></span>
        </a>
        <div className="nav-right">
          <a className="nav-link" href="#how">How it works</a>
          <a className="nav-link" href="#problem">Why it matters</a>
          <button type="button" className="nav-link" onClick={() => setContactOpen(true)}>
            Contact
          </button>
          <a className="nav-cta" href="#install">Get started</a>
        </div>
      </nav>

      <section className="hero" id="top">
        <span className="hero-eyebrow">The autonomous AEO + SEO agent</span>
        <h1>
          <span className="hero-pigeon"><PixelPigeon size={76} /></span>
          <span className="mw"><Brand /></span> gets your site
          <br />
          recommended by AI
        </h1>
        <p className="sub">
          AI assistants now answer buying questions directly &mdash; and point people to a
          <br />
          handful of sites. Pigeon finds every search where you&rsquo;re invisible, fixes what&rsquo;s
          missing, and proves it worked. On Shopify or any site.
        </p>

        <div className="cta">
          <a className="btn btn-primary" href="#install">
            Run a free scan
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14" />
              <path d="M13 6l6 6-6 6" />
            </svg>
          </a>
          <a className="btn btn-ghost" href="#how">
            See how it works
          </a>
        </div>

        <div className="hero-row">
          <span>Works on any site</span>
          <i />
          <span>Measures real AI answers</span>
        </div>
      </section>

      <ProblemScroll />

      <section className="features bento" id="how">
        <BentoCard
          tag="SEE WHERE YOU STAND"
          title="Find every search where AI hides you"
          desc="Pigeon runs the ~50 real questions your buyers ask AI assistants, then shows exactly which ones you show up on, where you rank, and who's winning the rest. No vanity score — just the map."
          mock={<ScanMock />}
        />
        <BentoCard
          tag="IT FIXES IT ITSELF"
          title="The agent makes the change, then proves it worked"
          desc="Pigeon writes the schema, the answer-first content, the meta — grounded in a real AEO/SEO playbook — then re-measures that exact search. It keeps only what moves the needle and auto-reverts the rest. It never repeats a dead end."
          mock={<FixMock />}
        />
        <BentoCard
          id="whitespace"
          tag="WIN THE RIGHT GAPS"
          title="Attack the searches you can actually take"
          desc="It surfaces the whitespace — high-demand searches where no strong competitor shows up — so your first wins are fast and worth it, ranked by how many people actually search them."
          mock={<WhitespaceMock />}
        />
        <EnginesBentoCard />
      </section>

      <GetStartedCard signupUrl={SIGNUP_URL} />

      <Faqs contactEmail={CONTACT_EMAIL} />

      <ContactPopup open={contactOpen} onClose={() => setContactOpen(false)} />

      <footer className="foot">
        <div className="foot-left">
          <div className="foot-brandrow">
            <PixelPigeon size={30} />
            <span className="foot-brand">
              <Brand />
            </span>
          </div>
          <span className="foot-right">get found by AI.</span>
        </div>
        <div className="foot-mid-col">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="foot-mid" src="/box/fbce08ffcfd01f555e3ae4c681899d7e.jpg" alt="" />
        </div>
      </footer>
    </main>
  );
}
