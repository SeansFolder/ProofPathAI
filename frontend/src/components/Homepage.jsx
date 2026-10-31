import React from 'react';
import './Homepage.css';
import heroPhoto from '../assets/report-hero.jpg';
import roadsPhoto from '../assets/report-hero.jpg';
import drainagePhoto from '../assets/category-drainage.jpg';
import wastePhoto from '../assets/category-waste.jpg';
import lightingPhoto from '../assets/category-lighting.jpg';
import facilitiesPhoto from '../assets/category-facilities.jpg';
import logo from '../assets/logo.png';
import mark from '../assets/logo-mark-on-dark.svg';

const CATEGORY_MAP = {
  'Roads & pathways': 'Road damage',
  'Drainage': 'Drainage and flooding',
  'Waste & sanitation': 'Waste and litter',
  'Street lighting': 'Street lighting',
  'Public facilities': 'Public facility',
};

const CATEGORIES = [
  { label: 'Roads & pathways', blurb: 'Potholes and uneven surfaces', photo: roadsPhoto, alt: 'Cracked road with a pothole' },
  { label: 'Drainage', blurb: 'Blocked drains and floodwater', photo: drainagePhoto, alt: 'Blocked drain with floodwater and litter' },
  { label: 'Waste & sanitation', blurb: 'Overflowing bins and litter', photo: wastePhoto, alt: 'Overflowing public bin with rubbish bags' },
  { label: 'Street lighting', blurb: 'Damaged or unlit streetlights', photo: lightingPhoto, alt: 'Damaged leaning streetlight' },
  { label: 'Public facilities', blurb: 'Shared spaces needing repair', photo: facilitiesPhoto, alt: 'Worn public bench under a shelter' },
];

const STEPS = [
  {
    number: '01',
    title: 'Document the issue',
    text: 'Add a clear photo of the road, drainage, waste, or public facility that needs attention.',
  },
  {
    number: '02',
    title: 'Review the details',
    text: 'Check the suggested observations, confirm the location, and add what you know.',
  },
  {
    number: '03',
    title: 'Keep a useful record',
    text: 'Save the report, share it through your chosen channel, and track its progress.',
  },
];

function LogoMark() {
  return <img className="home-logo" src={logo} alt="ProofPath" />;
}

function DocIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4 1.5 H9.5 L12.5 4.5 V14.5 H4 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.5 1.5 V4.5 H12.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6 8 H11 M6 10.5 H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 8 Q4 4.5 8 4.5 Q12 4.5 14.5 8 Q12 11.5 8 11.5 Q4 11.5 1.5 8 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5.5" cy="6.5" r="1.3" fill="currentColor" />
      <path d="M2.5 12 L6.5 8.5 L9.5 11 L11.5 9 L13.8 11.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Homepage({ sessionUser, onStartReport, onShowReports, onSignIn, onPrivacyHelp }) {
  function goToLogin() {
    if (onSignIn) {
      onSignIn();
      return;
    }
    window.location.assign('/login');
  }

  // Signed-out visitors go through the signup gate (parent redirects to
  // resident signup); signed-in users start the upload directly.
  function startReport(categoryLabel) {
    onStartReport(categoryLabel ? CATEGORY_MAP[categoryLabel] : '');
  }

  return (
    <div className="home">
      <div className="home-header-sticky">
      <header className="home-header">
        <span className="home-brand">
          <LogoMark />
        </span>
        <nav className="home-nav" aria-label="Homepage">
          <a href="#how-it-works">How it works</a>
          <button type="button" className="home-nav-link" onClick={onPrivacyHelp}>
            Privacy
          </button>
          {sessionUser ? (
            <button type="button" className="home-btn-primary" onClick={() => startReport('')}>
              New report
            </button>
          ) : (
            <button type="button" className="home-btn-primary" onClick={goToLogin}>
              Sign in
            </button>
          )}
        </nav>
      </header>
      </div>

      <div className="home-scroll">
      <div className="home-band-warm">
      <section className="home-hero">
        <div className="home-hero-copy">
          <h1>
            See it. Document it.
            <br />
            Improve your community.
          </h1>
          <p className="home-lede">Turn photos of local issues into clear reports you can review, share, and follow up on.</p>
          <div className="home-hero-actions">
            <button type="button" className="home-btn-primary home-btn-large" onClick={() => startReport('')}>
              Create a report <span aria-hidden="true">→</span>
            </button>
            <a className="home-text-link" href="#how-it-works">
              See how it works
            </a>
          </div>
          <p className="home-micro">
            {sessionUser ? 'Your reports stay with your account.' : 'Create an account to save your reports and follow their progress.'}
          </p>
        </div>
        <article className="home-report-card" aria-label="Example report">
          <div className="home-report-card-top">
            <span className="home-report-card-label">
              <DocIcon /> From evidence to a clear report
            </span>
            <span className="home-draft-pill">Draft</span>
          </div>
          <img className="home-report-photo" src={heroPhoto} alt="Cracked road surface with a pothole" />
          <h2>Uneven road surface near the footbridge</h2>
          <ul className="home-report-meta">
            <li>
              <EyeIcon /> 2 observations ready for your review
            </li>
            <li>
              <ImageIcon /> The photo stays attached to the report.
            </li>
          </ul>
        </article>
      </section>
      </div>

      <section className="home-steps" id="how-it-works" aria-labelledby="how-it-works-heading">
        <h2 id="how-it-works-heading">A useful report, one step at a time.</h2>
        <ol>
          {STEPS.map((step) => (
            <li key={step.number}>
              <span className="home-step-number">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="home-band-warm">
      <section className="home-categories" aria-labelledby="categories-heading">
        <h2 id="categories-heading">For the things you notice every day.</h2>
        <ul>
          {CATEGORIES.map((category) => (
            <li key={category.label}>
              <button type="button" className="home-category-card" onClick={() => startReport(category.label)}>
                <img className="home-category-photo" src={category.photo} alt={category.alt} loading="lazy" />
                <span className="home-category-body">
                  <span className="home-category-title">{category.label}</span>
                  <span className="home-category-blurb">{category.blurb}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="home-trust" id="privacy" aria-labelledby="privacy-heading">
        <div className="home-trust-panel">
          <div>
            <h2 id="privacy-heading">Clear reports. Human judgment.</h2>
            <p>AI helps organize the evidence. You verify the details, decide what to share, and update each report&rsquo;s status.</p>
          </div>
          <button type="button" className="home-btn-light" onClick={onPrivacyHelp}>
            Privacy &amp; reporting
          </button>
        </div>
      </section>
      </div>

      <div className="home-footer-band">
      <footer className="home-footer">
        <div className="home-footer-top">
          <span className="home-brand home-footer-brand">
            <img className="home-footer-mark" src={mark} alt="" />
            ProofPath
          </span>
          <nav aria-label="Footer">
            <button type="button" className="home-footer-link" onClick={onPrivacyHelp}>
              Privacy &amp; reporting
            </button>
            <button type="button" className="home-footer-link" onClick={onPrivacyHelp}>
              Help
            </button>
            <a className="home-footer-link" href="/login">
              Staff sign in
            </a>
          </nav>
        </div>
        <div className="home-footer-bottom">
          <span>&copy; {new Date().getFullYear()} ProofPath AI</span>
          <span>Community reporting assistant</span>
        </div>
      </footer>
      </div>
      </div>
    </div>
  );
}
