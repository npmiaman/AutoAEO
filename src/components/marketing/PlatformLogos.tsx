/* The engines Pigeon measures against. No external logos needed — rendered as
   tiles reusing the existing recipe-grid styling. */

const ENGINES = [
  "ChatGPT",
  "Perplexity",
  "Gemini",
  "Claude",
  "Google AI",
  "Copilot",
];

export function EnginesBentoCard() {
  return (
    <article className="bento-card" id="engines">
      <div className="bento-visual">
        <div className="mk mk-panel">
          <div className="mk-head">
            <span>engines measured</span>
            <span className="mk-sig">live web search</span>
          </div>
          <div className="rc-grid">
            {ENGINES.map((e) => (
              <div key={e} className="rc-tile">
                <span className="rc-name">{e}</span>
                <span className="rc-status">✓</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="bento-body">
        <span className="feat-tag">EVERY AI ANSWER</span>
        <h2 className="bento-title">We test the engines your buyers actually ask</h2>
        <p className="bento-desc">
          Pigeon runs real buyer searches through live, web-grounded AI engines &mdash; so what
          you see is where you truly stand, not a guess. Each engine ranks differently, so we
          measure them where it matters.
        </p>
        <p className="bento-foot">More engines added as buyers adopt them.</p>
      </div>
    </article>
  );
}
