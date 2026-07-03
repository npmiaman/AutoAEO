/* eslint-disable @next/next/no-img-element */

const COMPUTER_ART = "/box/fbce08ffcfd01f555e3ae4c681899d7e.jpg";

type Props = { signupUrl: string };

export default function GetStartedCard({ signupUrl }: Props) {
  return (
    <section className="start-sec" id="install">
      <div className="start-inner">
        <div className="start-head">
          <img className="start-art" src={COMPUTER_ART} alt="" aria-hidden />
          <div className="start-text">
            <h2 className="start-heading">
              Point <span className="brand-br">[</span>P<span className="brand-br">]</span>igeon
              at your site.
              <br />
              It scans, fixes, and keeps you cited by AI.
            </h2>
            <p className="start-sub">
              Connect your Shopify store or drop the SDK into any site. Pigeon runs a free
              visibility scan, shows you exactly where you&rsquo;re invisible, and then goes to
              work &mdash; measuring, fixing, and verifying, every day.
            </p>
          </div>
        </div>

        <a className="btn btn-primary start-btn" href={signupUrl}>
          Run my free scan
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
        </a>
      </div>
    </section>
  );
}
