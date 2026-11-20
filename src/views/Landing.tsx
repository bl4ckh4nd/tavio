import React, { useRef, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { useLingui } from '@lingui/react';
import { msg, t } from '@lingui/core/macro';
import { ArrowRight, ChevronDown, Menu, X } from 'lucide-react';
import { GitHubIcon } from '../components/BrandIcons';
import { BrandMark } from '../components/BrandMark';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { AppView, toRoomSlug } from '../types';
import { useLayDown, usePileDepth } from '../hooks/useLandingMotion';

interface LandingProps {
  onNavigate: (view: AppView, param?: string) => void;
}

const GITHUB_URL = 'https://github.com/bl4ckh4nd/tavio';

// Sample data on the pile of records: a room's name and its people are not copy.
const SAMPLE_ROOM = 'Design sync';
const SAMPLE_PEOPLE = 'Lena R., James M., Ava K., Tom C., Sara L., Morgan O., Priya N.';
// Commands are not copy; the terminal types them out, one character per step.
const DEPLOY_COMMANDS = ['git clone github.com/bl4ckh4nd/tavio', 'cd tavio', 'docker compose up -d --build'];
const DEPLOY_URL = 'http://localhost:3000/';
// Each line starts after the ones before it and a short pause, counted in typing steps.
const TYPE_PAUSE = 10;
const DEPLOY_LINES = DEPLOY_COMMANDS.map((line, index) => ({ line, at: DEPLOY_COMMANDS.slice(0, index).reduce((steps, before) => steps + before.length + TYPE_PAUSE, 0) }));
const DEPLOY_DONE = DEPLOY_COMMANDS.reduce((steps, line) => steps + line.length + TYPE_PAUSE, 0);

/** Each sentence of a head holds its own line. */
const SentenceLines: React.FC<{ text: string }> = ({ text }) => (
  <>
    {text.split(/(?<=\.)\s+/).map((line, index) => (
      <React.Fragment key={line}>{index > 0 && ' '}<span className="line">{line}</span></React.Fragment>
    ))}
  </>
);

export const Landing: React.FC<LandingProps> = ({ onNavigate }) => {
  const { _, i18n } = useLingui();
  const [roomSlug, setRoomSlug] = useState('');
  const [roomInvalid, setRoomInvalid] = useState(false);
  const [activeFaq, setActiveFaq] = useState<number | null>(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const roomInput = useRef<HTMLInputElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLElement>(null);
  const pile = useRef<HTMLDivElement>(null);
  useLayDown(page);
  usePileDepth(hero, pile);

  // The product shots are captured per language; German has its own set.
  const img = i18n.locale === 'de' ? '/landing/de' : '/landing';

  const handleJoin = (event: React.FormEvent) => {
    event.preventDefault();
    // Accept a pasted room link or a typed room name ("Design Sync" -> "design-sync").
    const input = roomSlug.trim();
    const fromLink = input.match(/\/room\/([^/?#]+)/)?.[1];
    let reference = fromLink ?? input;
    try { reference = decodeURIComponent(reference); } catch { /* keep the raw text for malformed escapes */ }
    const slug = toRoomSlug(reference);
    if (slug) {
      onNavigate(AppView.LOBBY, slug);
      return;
    }
    setRoomInvalid(true);
    roomInput.current?.focus();
  };

  const go = (view: AppView, param?: string) => {
    setMobileMenuOpen(false);
    onNavigate(view, param);
  };

  const closeMenu = () => setMobileMenuOpen(false);

  // The head arrives word by word; the stamp waits for the last one.
  const heroWords = _(msg`Meetings that leave a mark.`).split(' ');

  const scrollHome = () => window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });

  return (
    <div className="landing" ref={page}>
      <svg className="defs" aria-hidden="true">
        <filter id="landing-press" x="-4%" y="-20%" width="108%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.28" numOctaves={2} seed={11} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.8 1.34" result="mask" />
          <feComposite in="SourceGraphic" in2="mask" operator="in" result="ink" />
          <feOffset in="SourceAlpha" dx="0.5" dy="0.6" result="moved" />
          <feComposite in="SourceAlpha" in2="moved" operator="out" result="wall" />
          <feFlood floodOpacity="0.3" />
          <feComposite in2="wall" operator="in" result="shade" />
          <feMerge><feMergeNode in="ink" /><feMergeNode in="shade" /></feMerge>
        </filter>
      </svg>

      <a className="skip" href="#main"><Trans>Skip to content</Trans></a>

      <header className="nav" data-open={mobileMenuOpen}>
        <div className="shell nav__bar">
          <button type="button" onClick={scrollHome} className="nav__home" aria-label={t`Tavio home`}>
            <BrandMark className="text-ink" logoClassName="h-7 w-auto" />
          </button>
          <nav className="nav__links" aria-label={t`Main navigation`}>
            <a href="#benefits"><Trans>Product</Trans></a>
            <a href="#control"><Trans>Self-host</Trans></a>
            <button type="button" onClick={() => go(AppView.DOCS)}><Trans>Docs</Trans></button>
          </nav>
          {/* Field and button are one control; the placeholder and the field's name say what goes in. */}
          <form className="join" onSubmit={handleJoin} noValidate>
            <input
              ref={roomInput}
              id="hero-input"
              type="text"
              autoComplete="off"
              value={roomSlug}
              onChange={event => { setRoomSlug(event.target.value); setRoomInvalid(false); }}
              placeholder={_(msg`Room name or link`)}
              aria-label={_(msg`Room name or link`)}
              aria-invalid={roomInvalid || undefined}
            />
            <button type="submit"><Trans context="join a room">Join</Trans><ArrowRight className="icon" aria-hidden="true" /></button>
          </form>
          <span className="nav__rule" aria-hidden="true" />
          <button type="button" onClick={() => go(AppView.AUTH, 'login')} className="nav__login"><Trans>Log In</Trans></button>
          <button type="button" onClick={() => go(AppView.AUTH, 'register')} className="btn btn--card btn--s nav__create"><Trans>Create a room</Trans></button>
          <button type="button" onClick={() => setMobileMenuOpen(open => !open)} className="nav__menu" aria-label={mobileMenuOpen ? t`Close menu` : t`Open menu`} aria-expanded={mobileMenuOpen} aria-controls="nav-sheet">{mobileMenuOpen ? <X className="icon" /> : <Menu className="icon" />}</button>
        </div>
        {/* The phone's menu; on wider screens everything in it already sits in the bar or the footer. */}
        {mobileMenuOpen && (
          <div id="nav-sheet" className="shell nav__sheet">
            <nav className="nav__sheet-links" aria-label={t`Main navigation`}>
              <a href="#benefits" onClick={closeMenu}><Trans>Product</Trans></a>
              <a href="#control" onClick={closeMenu}><Trans>Self-host</Trans></a>
              <button type="button" onClick={() => go(AppView.DOCS)}><Trans>Docs</Trans></button>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" onClick={closeMenu}><GitHubIcon className="icon" /><Trans>GitHub</Trans></a>
            </nav>
            <div className="nav__sheet-actions">
              <button type="button" onClick={() => go(AppView.AUTH, 'login')} className="nav__sheet-login"><Trans>Log In</Trans></button>
              <button type="button" onClick={() => go(AppView.AUTH, 'register')} className="btn btn--card btn--s"><Trans>Create a room</Trans></button>
            </div>
            <div className="nav__sheet-lang"><LanguageSwitcher className="lang" /></div>
          </div>
        )}
      </header>

      <main id="main">
        <section ref={hero} className="hero desk" aria-labelledby="hero-heading" style={{ '--words': heroWords.length } as React.CSSProperties}>
          <div className="shell hero__stage">
            <div ref={pile} className="pile">
              <figure className="print print--board stock">
                <img src={`${img}/board-canvas.webp`} width="1400" height="706" alt={t`The room's whiteboard with its drawing tools and a sketched flow from lobby to room to summary`} />
              </figure>
              <figure className="print print--call stock">
                <img src={`${img}/hero-grid.webp`} width="2000" height="1076" alt={t`The Tavio meeting room with six people on camera and the toolbar`} fetchPriority="high" />
              </figure>
              <p className="tag stock"><span><Trans>Room link</Trans></span><code>tavio.app/room/design-sync</code></p>
              <article className="sheet stock" aria-label={SAMPLE_ROOM}>
                <p className="sheet__title">{SAMPLE_ROOM}</p>
                <p className="sheet__names">{SAMPLE_PEOPLE}</p>
                <dl className="sheet__rows">
                  <div><dt><Trans>Duration</Trans></dt><dd>18:42</dd></div>
                  <div><dt><Trans>Participants</Trans></dt><dd>7</dd></div>
                  <div><dt><Trans>Chat messages</Trans></dt><dd>12</dd></div>
                </dl>
                <p className="sheet__part"><b><Trans context="the next step of a meeting">Next</Trans></b><Trans>Share the prototype before Friday.</Trans></p>
                <p className="sheet__part sheet__rec"><Trans>A recording was made and is processing</Trans></p>
                <p className="pressed"><Trans>Saved in this room</Trans></p>
              </article>
            </div>
            <div className="hero__base">
              <h1 id="hero-heading">{heroWords.map((word, index) => (
                <React.Fragment key={index}>{index > 0 && ' '}<span className="hw" style={{ '--i': index } as React.CSSProperties}>{word}</span></React.Fragment>
              ))}</h1>
              <div className="hero__foot">
                <div className="hero__say">
                  <p className="lead"><Trans>Video meetings in the browser, with notes, whiteboard and recording in the same room. Guests join from a link, with no account and nothing to install.</Trans></p>
                  <ul className="hero__facts">
                    <li><Trans>Source available</Trans></li>
                    <li><Trans>Self-hostable</Trans></li>
                    <li><Trans>Runs in the browser</Trans></li>
                  </ul>
                </div>
                <div className="hero__actions">
                  <button type="button" onClick={() => go(AppView.AUTH, 'register')} className="btn btn--ink"><Trans>Create your first room</Trans></button>
                  <a className="link hero__more" href="#preview"><Trans>See what a room looks like</Trans></a>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="benefits" className="sec sec--problem" aria-labelledby="benefits-heading">
          <div className="shell grid12 split">
            <h2 id="benefits-heading"><SentenceLines text={_(msg`Your meeting ends. The work scatters.`)} /></h2>
            <p className="lead"><Trans><strong>Meetings shouldn’t create more work.</strong> The call happens in one tool and the notes live in another. Decisions disappear into chat, and guests lose time on accounts and installs. Tavio keeps the conversation and its outcome in one place.</Trans></p>
          </div>
          <div className="shell run">
            <article className="grid12 run__row">
              <div className="run__text">
                <h3><Trans>Guests are in with one link</Trans></h3>
                <p><Trans>Share one room link and guests join straight from the browser. You set who gets in, room by room.</Trans></p>
              </div>
              <figure className="print run__proof stock" data-lay="">
                <picture>
                  <source media="(max-width: 40rem)" srcSet={`${img}/phone-lobby.webp`} width="780" height="1740" />
                  <img src={`${img}/lobby.webp`} width="1800" height="836" alt={t`The Tavio lobby: a camera preview with the room link, beside the display name, the microphone and camera choice and the join button`} loading="lazy" />
                </picture>
              </figure>
            </article>
            <article id="preview" className="grid12 run__row">
              <div className="run__text">
                <h3><Trans>Work together without tab-hopping</Trans></h3>
                <p><Trans>Talk, take shared notes, sketch on the whiteboard, share your screen and open breakout rooms, all in the same room.</Trans></p>
              </div>
              <figure className="print run__proof stock" data-lay="">
                <picture>
                  <source media="(max-width: 40rem)" srcSet={`${img}/phone-notes.webp`} width="780" height="1520" />
                  <img src={`${img}/room-notes.webp`} width="2000" height="1125" alt={t`The meeting room with one person shown large, the others beside them and the shared notes open in the side panel: agenda, decisions and next step`} loading="lazy" />
                </picture>
              </figure>
            </article>
            <article className="grid12 run__row run__row--even">
              <div className="run__text">
                <h3><Trans>Leave the meeting with decisions</Trans></h3>
                <p><Trans>Recording, notes and next steps stay in the room, so everyone knows what was said and what comes next.</Trans></p>
              </div>
              <div className="run__proof run__stack" data-lay="">
                <figure className="print stock">
                  <img src={`${img}/summary.webp`} width="1200" height="1104" alt={t`The end-of-call summary: duration, participants, chat messages, notes saved to the room and a recording in processing`} loading="lazy" />
                </figure>
                <div className="stamped stock">
                  <p><b><Trans context="the next step of a meeting">Next</Trans></b><Trans>Share the prototype before Friday.</Trans></p>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section id="control" className="sec board-band" aria-labelledby="control-heading">
          <div className="shell grid12">
            <div className="board-band__text">
              <h2 id="control-heading"><SentenceLines text={_(msg`Your meetings. Your infrastructure. Your rules.`)} /></h2>
              <p className="lead"><Trans><strong>Built in the open.</strong> Use Tavio hosted, or run the stack on your own servers. You decide where it runs, how guests join and who controls the meeting data.</Trans></p>
              <a className="link board-band__link" href={GITHUB_URL} target="_blank" rel="noreferrer"><Trans>See Tavio on GitHub</Trans></a>
            </div>
            <pre className="board-band__sheet stock" data-lay=""><code>{DEPLOY_LINES.map(({ line, at }) => (
              <span key={line} className="type" style={{ '--n': line.length, '--at': at } as React.CSSProperties}>{line}</span>
            ))}</code><samp style={{ '--at': DEPLOY_DONE } as React.CSSProperties}>{_(msg`Convex · LiveKit · web app`)}{'\n'}{DEPLOY_URL}</samp></pre>
          </div>
        </section>

        <section className="sec faq" aria-labelledby="faq-heading">
          <div className="shell grid12">
            <h2 id="faq-heading"><Trans>Questions, answered plainly.</Trans></h2>
            <div className="faq__rows">{[
              { q: _(msg`Do guests need an account or an app?`), a: _(msg`No. Guests join from the room link or the room name in a browser, on desktop or on a phone. Only people who create or manage rooms need an account.`) },
              { q: _(msg`What stays after the meeting?`), a: _(msg`Notes, whiteboard and recording stay in the room. At the end, a summary shows the duration, the participants and the next step.`) },
              { q: _(msg`What is included in a room?`), a: _(msg`Video, audio, screen sharing, chat, shared notes, whiteboard, breakout rooms and recordings.`) },
              { q: _(msg`Can we run Tavio ourselves?`), a: _(msg`Yes. Tavio's source code is public under the FSL-1.1-ALv2. Use the hosted version or run the stack in your own environment.`) },
              { q: _(msg`How do we control room access?`), a: _(msg`For each room you choose: open, workspace members only, or password protected.`) },
            ].map((item, index) => (
              <div key={item.q} className="faq__item">
                <h3><button type="button" onClick={() => setActiveFaq(activeFaq === index ? null : index)} className="faq__q" aria-expanded={activeFaq === index} aria-controls={`faq-${index}`}><span>{item.q}</span><ChevronDown className="icon" /></button></h3>
                <div className="faq__a" id={`faq-${index}`} hidden={activeFaq !== index}><p>{item.a}</p></div>
              </div>
            ))}</div>
          </div>
        </section>

        <section className="close desk" aria-labelledby="close-heading">
          <div className="shell grid12">
            <h2 id="close-heading"><Trans>Hold your next meeting in a room that stays.</Trans></h2>
            <div className="close__act">
              <p><Trans>Create a room, share the link and start.</Trans></p>
              <button type="button" onClick={() => go(AppView.AUTH, 'register')} className="btn btn--ink"><Trans>Create your first room</Trans></button>
            </div>
          </div>
        </section>
      </main>

      <footer className="colophon">
        <div className="shell colophon__in">
          <div className="colophon__mark"><BrandMark className="text-ink" logoClassName="h-6 w-auto" /><p><Trans>Meeting rooms in the browser.</Trans></p></div>
          <nav className="colophon__links" aria-label={t`Footer navigation`}>
            <button type="button" onClick={() => go(AppView.DOCS)}><Trans>Docs</Trans></button>
            <a href={GITHUB_URL} target="_blank" rel="noreferrer"><Trans>GitHub</Trans></a>
            <LanguageSwitcher className="lang" />
          </nav>
        </div>
      </footer>
    </div>
  );
};
