
import React, { useEffect, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';
import {
  ArrowLeft, Search, Book,
  Server, Shield, Code2, Copy, Check, KeyRound
} from 'lucide-react';
import { AppView } from '../types';
import { Button, Card, Input, Notice, Tag } from '../components/ui';
import { BrandMark } from '../components/BrandMark';
import { useToast } from '../components/ToastProvider';

interface DocsProps {
  onNavigate: (view: AppView) => void;
}

const BODY = 'max-w-[65ch] text-md leading-normal text-ink-2';
const CODE = 'fig box-decoration-clone rounded-tag bg-paper-2 px-1 py-0.5 text-sm text-ink';
const SECTION = 'space-y-4 border-t border-rule pt-10';
const TH = 'border-b border-rule-2 py-2 pr-6 font-medium last:pr-0';
const SEARCH_ID = 'docs-search';

const GETTING_STARTED = [
  { id: 'introduction', label: <Trans>Introduction</Trans> },
  { id: 'quick-start', label: <Trans>Quick Start</Trans> },
  { id: 'architecture', label: <Trans>Architecture</Trans> },
];
const DEPLOYMENT = [
  { id: 'docker', label: <Trans>Docker</Trans> },
  { id: 'configuration', label: <Trans>Configuration</Trans> },
  { id: 'ssl', label: <Trans>SSL & Domains</Trans> },
  { id: 'webhooks', label: <Trans>Webhooks</Trans> },
];
// The same steps as scripts/e2e-local.sh, with the trial's port.
const TRIAL_SETUP = `docker compose exec convex-backend ./generate_admin_key.sh

# .env.trial
CONVEX_SELF_HOSTED_URL=http://127.0.0.1:3210
CONVEX_SELF_HOSTED_ADMIN_KEY=<the key from above>

npx convex env set --env-file .env.trial SITE_URL http://localhost:3000
npx convex env set --env-file .env.trial BETTER_AUTH_SECRET "$(openssl rand -hex 32)"
npx convex env set --env-file .env.trial LIVEKIT_API_KEY devkey
npx convex env set --env-file .env.trial LIVEKIT_API_SECRET secret
npx convex env set --env-file .env.trial LIVEKIT_HOST ws://localhost:7880
npx convex env set --env-file .env.trial LIVEKIT_API_HOST http://host.docker.internal:7880
npx convex dev --once --env-file .env.trial`;

const API = [
  { id: 'api', label: <Trans>Overview</Trans> },
  { id: 'api-rooms', label: <Trans>Rooms</Trans> },
  { id: 'api-recordings', label: <Trans>Recordings</Trans> },
];

const SECTIONS = [...GETTING_STARTED, ...DEPLOYMENT, ...API];

const API_BASE = `${import.meta.env.VITE_CONVEX_SITE_URL || 'https://<deployment>.convex.site'}/v1`;
// Literal braces inside <Trans> would be read as message placeholders, so these go in as values.
const ROOM_PARAM = '{room}';
const ROOM_FILTER = '?room={room}';
const LIST_SHAPE = '{ "data": [...] }';
const ERROR_SHAPE = '{ "error": { "code": "conflict", "message": "…" } }';
const EXAMPLE_ROOM = `{
  "id": "kx71rxedbcdx8137jwr16frr718jkrvv",
  "name": "Weekly sync",
  "slug": "weekly-sync-7awlt8",
  "url": "${typeof window === 'undefined' ? '' : window.location.origin}/room/weekly-sync-7awlt8",
  "access": "OPEN",
  "activeParticipants": 0,
  "createdAt": "2026-11-20T16:05:45.268Z"
}`;
const EXAMPLE_RECORDING = `{
  "id": "jd7f3k2m9q8w1e5r6t7y8u9i0o1p2a3s",
  "roomId": "kx71rxedbcdx8137jwr16frr718jkrvv",
  "status": "completed",
  "startedAt": "2026-11-20T15:00:02.114Z",
  "endedAt": "2026-11-20T15:42:40.903Z",
  "durationMs": 2558789,
  "transcriptStatus": "completed",
  "downloadUrl": "https://…"
}`;

// Below sm each variable stacks instead of squeezing three columns, so the table parts name their roles themselves.
// Short names (API fields, status codes) stay whole; long variable names may wrap anywhere.
const ConfigRow: React.FC<{ name: string; where: React.ReactNode; whereLabel?: string; children: React.ReactNode }> = ({ name, where, whereLabel, children }) => (
  <tr role="row" className="border-b border-rule max-sm:grid max-sm:gap-1 max-sm:py-3">
    <td role="cell" className={`fig py-3 pr-6 text-sm text-ink max-sm:p-0 ${name.length > 12 ? '[overflow-wrap:anywhere]' : 'whitespace-nowrap'}`}>{name}</td>
    <td role="cell" data-label={whereLabel ?? t`Set in`} className="py-3 pr-6 text-sm text-muted max-sm:p-0 max-sm:before:mr-2 max-sm:before:text-xs max-sm:before:content-[attr(data-label)]">{where}</td>
    <td role="cell" className="py-3 text-ink-2 max-sm:p-0">{children}</td>
  </tr>
);

const CodeBlock: React.FC<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = useState(false);
  const toast = useToast();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t`Could not copy. Select the text instead.`);
    }
  };

  return (
    <div className="overflow-hidden rounded-stock border border-rule bg-paper-2">
      <div className="flex items-center justify-end border-b border-rule p-1">
        <Button variant="ghost" size="sm" className="hover:bg-paper-3" onClick={() => void copy()}>
          {copied ? <Check className="icon" aria-hidden="true" /> : <Copy className="icon" aria-hidden="true" />}
          {copied ? <Trans>Copied</Trans> : <Trans>Copy</Trans>}
        </Button>
      </div>
      <pre className="fig overflow-x-auto p-4 text-sm text-ink">{code}</pre>
    </div>
  );
};

const Table: React.FC<{ head: [React.ReactNode, React.ReactNode, React.ReactNode]; children: React.ReactNode }> = ({ head, children }) => (
  <div className="overflow-x-auto">
    <table role="table" className="w-full text-left text-sm max-sm:block max-sm:border-t max-sm:border-rule-2">
      <thead role="rowgroup" className="text-xs text-muted max-sm:sr-only">
        <tr role="row">
          {head.map((cell, index) => <th key={index} role="columnheader" className={TH}>{cell}</th>)}
        </tr>
      </thead>
      <tbody role="rowgroup" className="max-sm:block">{children}</tbody>
    </table>
  </div>
);

const Endpoint: React.FC<{ method: string; path: string; children: React.ReactNode }> = ({ method, path, children }) => (
  <Card className="overflow-hidden">
    <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3">
      <Tag className="fig uppercase">{method}</Tag>
      <code className="fig min-w-0 text-sm text-ink [overflow-wrap:anywhere]">{path}</code>
    </div>
    <div className="space-y-3 p-4 text-sm text-ink-2">{children}</div>
  </Card>
);

export const Docs: React.FC<DocsProps> = ({ onNavigate }) => {
  const [activeSection, setActiveSection] = useState('introduction');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<typeof SECTIONS>([]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        document.getElementById(SEARCH_ID)?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const element = document.getElementById(id);
    if (element) {
      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      element.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    }
  };

  // Links such as /docs#api from the dashboard open at their section.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (SECTIONS.some(section => section.id === id)) scrollToSection(id);
  }, []);

  // Searches what the page shows, so it works in every language without a separate index.
  const search = (value: string) => {
    setQuery(value);
    const needle = value.trim().toLocaleLowerCase();
    setMatches(needle
      ? SECTIONS.filter(({ id }) => document.getElementById(id)?.textContent?.toLocaleLowerCase().includes(needle))
      : []);
  };

  const openMatch = (id: string) => {
    search('');
    scrollToSection(id);
  };

  const navItemClass = (id: string) =>
    `-ml-px flex w-full items-center border-l-2 pl-4 text-left text-sm pointer-coarse:min-h-11 ${activeSection === id ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink'}`;

  const tocStep = Math.max(0, SECTIONS.findIndex(({ id }) => id === activeSection));

  return (
    <div className="ground g-paper flex min-h-screen flex-col">
      {/* Header */}
      <header className="bar sticky top-0 z-(--z-sticky-nav) max-sm:min-h-14 max-sm:gap-3">
        <button
          type="button"
          className="group flex min-h-11 min-w-0 items-center gap-2 rounded-input"
          onClick={() => onNavigate(AppView.LANDING)}
          aria-label={t`Back to home`}
        >
          <BrandMark logoClassName="bar__logo" />
          <span className="truncate text-sm font-medium text-muted group-hover:text-ink"><Trans>Docs</Trans></span>
        </button>

        <div className="bar__end">
          <div className="relative hidden w-52 md:block lg:w-64 xl:w-72">
            <Input
              id={SEARCH_ID}
              type="search"
              aria-label={t`Search documentation...`}
              placeholder={t`Search documentation...`}
              className="pr-12 text-ellipsis"
              leftIcon={<Search className="icon" aria-hidden="true" />}
              rightIcon={<kbd className="fig pointer-events-none rounded-tag border border-rule-2 px-1 text-xs text-muted">⌘K</kbd>}
              value={query}
              onChange={(e) => search(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') search('');
                if (e.key === 'Enter' && matches[0]) openMatch(matches[0].id);
              }}
            />
            {query.trim() && (
              <div className="menu stock stock--lift absolute right-0 top-full z-(--z-sticky-nav) mt-1 w-full">
                {matches.length === 0 ? (
                  <p role="status" className="px-3 py-2 text-sm text-muted"><Trans>No results</Trans></p>
                ) : matches.map(({ id, label }) => (
                  <button key={id} type="button" className="menu__item" onClick={() => openMatch(id)}>{label}</button>
                ))}
              </div>
            )}
          </div>
          <Button variant="outline" size="sm" className="sm:min-h-10 sm:px-4" onClick={() => onNavigate(AppView.LANDING)}>
            <ArrowLeft className="icon" aria-hidden="true" />
            <span className="sr-only sm:not-sr-only"><Trans>Back to App</Trans></span>
          </Button>
        </div>
      </header>

      <div className="wrap flex flex-1">
        {/* Sidebar */}
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 overflow-y-auto border-r border-rule py-10 pr-6 lg:block">
          <div className="space-y-8">
            <div className="space-y-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Book className="icon text-muted" aria-hidden="true" /> <Trans>Getting Started</Trans>
              </h4>
              <ul className="ml-2 space-y-2 border-l border-rule">
                {GETTING_STARTED.map(({ id, label }) => (
                  <li key={id}><button type="button" onClick={() => scrollToSection(id)} className={navItemClass(id)}>{label}</button></li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Server className="icon text-muted" aria-hidden="true" /> <Trans>Deployment</Trans>
              </h4>
              <ul className="ml-2 space-y-2 border-l border-rule">
                {DEPLOYMENT.map(({ id, label }) => (
                  <li key={id}><button type="button" onClick={() => scrollToSection(id)} className={navItemClass(id)}>{label}</button></li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <KeyRound className="icon text-muted" aria-hidden="true" /> <Trans>API</Trans>
              </h4>
              <ul className="ml-2 space-y-2 border-l border-rule">
                {API.map(({ id, label }) => (
                  <li key={id}><button type="button" onClick={() => scrollToSection(id)} className={navItemClass(id)}>{label}</button></li>
                ))}
              </ul>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="min-w-0 flex-1 space-y-16 pt-10 pb-32 lg:px-16">

          {/* Introduction */}
          <section id="introduction" className="space-y-6">
            <div className="space-y-4">
              <h1 className="h-page"><Trans>Introduction</Trans></h1>
              <p className={BODY}>
                <Trans>Tavio is a meeting platform with public source code. Calls, shared notes, whiteboard, chat and recording live in one room, and guests join from the browser without an account.</Trans>
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
               <Card className="p-4">
                 <h3 className="panel__title flex items-center gap-2">
                   <Shield className="icon text-muted" aria-hidden="true" /> <Trans>Yours to run</Trans>
                 </h3>
                 <p className="mt-2 text-sm text-ink-2">
                   <Trans>Run it on your own machines, or use LiveKit Cloud and Convex Cloud. You decide where your meetings and data live.</Trans>
                 </p>
               </Card>
               <Card className="p-4">
                 <h3 className="panel__title flex items-center gap-2">
                   <Code2 className="icon text-muted" aria-hidden="true" /> <Trans>Source available</Trans>
                 </h3>
                 <p className="mt-2 text-sm text-ink-2">
                   <Trans>Licensed under the Functional Source License (FSL-1.1-ALv2). Each release becomes Apache-2.0 two years after it ships.</Trans>
                 </p>
               </Card>
            </div>
          </section>

          {/* Quick Start */}
          <section id="quick-start" className={SECTION}>
            <h2 className="h-sec"><Trans>Quick Start</Trans></h2>
            <p className={BODY}>
              <Trans>You need Node.js, a Convex account, and a LiveKit server or LiveKit Cloud account.</Trans>
            </p>
            <CodeBlock code={'git clone https://github.com/bl4ckh4nd/tavio.git\ncd tavio\nnpm install\ncp .env.example .env.local'} />
            <p className={BODY}>
              <Trans>Fill in the Convex and LiveKit values in <code className={CODE}>.env.local</code>, then start the backend and the app in two terminals.</Trans>
            </p>
            <CodeBlock code={'npx convex dev\nnpm run dev'} />
            <Notice>
              <p>
                <span className="font-semibold text-ink"><Trans>Note:</Trans></span>{' '}
                <Trans>The app runs at <code className={CODE}>http://localhost:3333</code>.</Trans>
              </p>
            </Notice>
          </section>

          {/* Architecture */}
          <section id="architecture" className={SECTION}>
            <h2 className="h-sec"><Trans>Architecture</Trans></h2>
            <p className={BODY}>
              <Trans>Tavio keeps what is live apart from what lasts, so shared work survives a dropped connection.</Trans>
            </p>
            <ul className={`${BODY} list-disc space-y-2 pl-5`}>
              <li><Trans>LiveKit carries video, audio, screen sharing and who is in the call.</Trans></li>
              <li><Trans>Convex keeps rooms, notes, the whiteboard, chat history and permissions.</Trans></li>
              <li><Trans>Better Auth handles accounts, with email and password, GitHub or Google.</Trans></li>
              <li><Trans>The web app is React and Vite, and it is served as static files.</Trans></li>
            </ul>
          </section>

          {/* Docker */}
          <section id="docker" className={SECTION}>
            <h2 className="h-sec"><Trans>Docker</Trans></h2>
            <p className={BODY}>
              <Trans><code className={CODE}>docker-compose.yml</code> starts a trial on one machine: Convex and its dashboard, LiveKit, and the web app at <code className={CODE}>http://localhost:3000</code>.</Trans>
            </p>
            <CodeBlock code="docker compose up -d --build" />
            <p className={BODY}>
              <Trans>The trial does not push the backend on its own. Create an admin key, save it in <code className={CODE}>.env.trial</code> with the backend address, then set the backend settings and push the functions.</Trans>
            </p>
            <CodeBlock code={TRIAL_SETUP} />
            <Notice>
              <p>
                <span className="font-semibold text-ink"><Trans>Note:</Trans></span>{' '}
                <Trans>For trials only: LiveKit runs in dev mode with public keys, and the Convex instance secret is a sample. For production use <code className={CODE}>deploy/docker-compose.deploy.yml</code>, which requires your own secrets.</Trans>
              </p>
            </Notice>
          </section>

          {/* Configuration */}
          <section id="configuration" className={SECTION}>
             <h2 className="h-sec"><Trans>Configuration</Trans></h2>
             <p className={BODY}>
               <Trans>Build settings go into <code className={CODE}>.env.local</code> and backend settings are set with <code className={CODE}>npx convex env set</code>. <code className={CODE}>.env.example</code> lists all of them.</Trans>
             </p>

             <div className="overflow-x-auto">
               <table role="table" className="w-full text-left text-sm max-sm:block max-sm:border-t max-sm:border-rule-2">
                 <thead role="rowgroup" className="text-xs text-muted max-sm:sr-only">
                   <tr role="row">
                     <th role="columnheader" className={TH}><Trans>Variable</Trans></th>
                     <th role="columnheader" className={TH}><Trans>Set in</Trans></th>
                     <th role="columnheader" className={TH}><Trans>Description</Trans></th>
                   </tr>
                 </thead>
                 <tbody role="rowgroup" className="max-sm:block">
                   <ConfigRow name="VITE_CONVEX_URL" where={<Trans>Build</Trans>}><Trans>Address of your Convex deployment.</Trans></ConfigRow>
                   <ConfigRow name="VITE_CONVEX_SITE_URL" where={<Trans>Build</Trans>}><Trans>Its HTTP address, used for sign-in.</Trans></ConfigRow>
                   <ConfigRow name="SITE_URL" where="Convex"><Trans>Public address of the app, used for sign-in redirects.</Trans></ConfigRow>
                   <ConfigRow name="BETTER_AUTH_SECRET" where="Convex"><Trans>Encrypts sessions.</Trans></ConfigRow>
                   <ConfigRow name="LIVEKIT_HOST" where="Convex"><Trans>Address of your LiveKit server.</Trans></ConfigRow>
                   <ConfigRow name="LIVEKIT_API_KEY, LIVEKIT_API_SECRET" where="Convex"><Trans>Sign the tokens for joining a call.</Trans></ConfigRow>
                   <ConfigRow name="R2_ENDPOINT, R2_BUCKET" where="Convex"><Trans>Optional. Storage for recordings, together with its access keys.</Trans></ConfigRow>
                   <ConfigRow name="DEEPGRAM_API_KEY" where="Convex"><Trans>Optional. Transcribes recordings.</Trans></ConfigRow>
                   <ConfigRow name="RESEND_API_KEY" where="Convex"><Trans>Optional. Sends password reset and verification email.</Trans></ConfigRow>
                   <ConfigRow name="GITHUB_CLIENT_ID, GOOGLE_CLIENT_ID" where="Convex"><Trans>Optional. Sign-in with GitHub or Google, together with their secrets.</Trans></ConfigRow>
                   <ConfigRow name="STRIPE_SECRET_KEY" where="Convex"><Trans>Optional. Turns on paid plans.</Trans></ConfigRow>
                 </tbody>
               </table>
             </div>
          </section>

          {/* SSL */}
          <section id="ssl" className={SECTION}>
            <h2 className="h-sec"><Trans>SSL & Domains</Trans></h2>
            <p className={BODY}>
              <Trans>Browsers only give access to the camera and microphone on HTTPS or localhost, so a public deployment needs a certificate. The app container serves plain HTTP on port 80, so put a reverse proxy with TLS in front of it.</Trans>
            </p>
            <p className={BODY}>
              <Trans>Give LiveKit a <code className={CODE}>wss://</code> address in <code className={CODE}>LIVEKIT_HOST</code> and set <code className={CODE}>SITE_URL</code> to your public address.</Trans>
            </p>
          </section>

          {/* Webhooks */}
          <section id="webhooks" className={SECTION}>
            <h2 className="h-sec"><Trans>Webhooks</Trans></h2>
            <p className={BODY}>
              <Trans>Convex receives events from other services at these paths on its HTTP address.</Trans>
            </p>

            <div className="space-y-4">
               <Card className="overflow-hidden">
                 <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3">
                   <Tag className="fig uppercase">POST</Tag>
                   <code className="fig min-w-0 text-sm text-ink [overflow-wrap:anywhere]">/livekit/egress</code>
                 </div>
                 <p className="p-4 text-sm text-ink-2">
                   <Trans>LiveKit reports the state of recordings here. Set <code className={CODE}>LIVEKIT_EGRESS_WEBHOOK_URL</code> to this address.</Trans>
                 </p>
               </Card>
               <Card className="overflow-hidden">
                 <div className="flex flex-wrap items-center gap-3 border-b border-rule px-4 py-3">
                   <Tag className="fig uppercase">POST</Tag>
                   <code className="fig min-w-0 text-sm text-ink [overflow-wrap:anywhere]">/stripe/webhook</code>
                 </div>
                 <p className="p-4 text-sm text-ink-2"><Trans>Stripe reports subscription changes here.</Trans></p>
               </Card>
            </div>
          </section>


          {/* API */}
          <section id="api" className={SECTION}>
            <h2 className="h-sec"><Trans>API</Trans></h2>
            <p className={BODY}>
              <Trans>With the REST API your own software creates and deletes rooms, lists them, and reads recordings, transcripts and past sessions. A booking system can open a room for each appointment and send the link to the guests.</Trans>
            </p>
            <h3 className="panel__title"><Trans>Keys</Trans></h3>
            <p className={BODY}>
              <Trans>Owners and admins create keys in the dashboard under Settings, API keys. A key acts for its workspace and sees only that workspace's rooms. The dashboard shows a key once, when you create it. If a key gets out, revoke it there; requests with it stop at once.</Trans>
            </p>
            <p className={BODY}>
              <Trans>Send the key in the <code className={CODE}>Authorization</code> header. Call the API from your server only: it does not answer browsers from other sites, and a key in a web page would be readable by anyone.</Trans>
            </p>
            <CodeBlock code={`curl ${API_BASE}/rooms \\\n  -H "Authorization: Bearer $TAVIO_API_KEY"`} />
            <p className={BODY}>
              <Trans>All addresses below start with <code className={CODE}>{API_BASE}</code>. Bodies are JSON, times are ISO 8601 in UTC, and lists come as <code className={CODE}>{LIST_SHAPE}</code>.</Trans>
            </p>
            <h3 className="panel__title"><Trans>Errors and limits</Trans></h3>
            <p className={BODY}>
              <Trans>A failed request answers with a status code and a body like <code className={CODE}>{ERROR_SHAPE}</code>. Each key may send 120 requests a minute, with bursts of up to 60. Above that the API answers 429 and says in <code className={CODE}>Retry-After</code> how many seconds to wait.</Trans>
            </p>
            <Table head={[<Trans>Status</Trans>, <Trans>Code</Trans>, <Trans>Meaning</Trans>]}>
              <ConfigRow name="400" where="invalid_request" whereLabel={t`Code`}><Trans>The body or a field is not valid. The message says which.</Trans></ConfigRow>
              <ConfigRow name="401" where="unauthorized" whereLabel={t`Code`}><Trans>The key is missing, unknown or revoked.</Trans></ConfigRow>
              <ConfigRow name="403" where="plan_limit" whereLabel={t`Code`}><Trans>The workspace has as many rooms as its plan allows.</Trans></ConfigRow>
              <ConfigRow name="404" where="not_found" whereLabel={t`Code`}><Trans>No such room or recording in this workspace, or no such path.</Trans></ConfigRow>
              <ConfigRow name="405" where="method_not_allowed" whereLabel={t`Code`}><Trans>The path exists, but not with this method. The <code className={CODE}>Allow</code> header lists the methods.</Trans></ConfigRow>
              <ConfigRow name="409" where="conflict" whereLabel={t`Code`}><Trans>Another room already uses this slug.</Trans></ConfigRow>
              <ConfigRow name="429" where="rate_limited" whereLabel={t`Code`}><Trans>Too many requests with this key.</Trans></ConfigRow>
            </Table>
          </section>

          <section id="api-rooms" className={SECTION}>
            <h2 className="h-sec"><Trans>Rooms</Trans></h2>
            <p className={BODY}>
              <Trans>Wherever a path takes <code className={CODE}>{ROOM_PARAM}</code>, you can give the room's id or its slug.</Trans>
            </p>
            <div className="space-y-4">
              <Endpoint method="POST" path="/v1/rooms">
                <p><Trans>Creates a room and returns it with the link for your guests.</Trans></p>
                <Table head={[<Trans>Field</Trans>, <Trans>Type</Trans>, <Trans>Description</Trans>]}>
                  <ConfigRow name="name" where="string" whereLabel={t`Type`}><Trans>Required. Up to 100 characters.</Trans></ConfigRow>
                  <ConfigRow name="slug" where="string" whereLabel={t`Type`}><Trans>Optional. The end of the room link: 3 to 50 lowercase letters, digits and hyphens. Without it the API makes one from the name, such as <code className={CODE}>weekly-sync-7awlt8</code>.</Trans></ConfigRow>
                  <ConfigRow name="access" where="string" whereLabel={t`Type`}><Trans><code className={CODE}>OPEN</code> (default): anyone with the link. <code className={CODE}>MEMBERS</code>: workspace members only. <code className={CODE}>PASSWORD</code>: anyone with the link and the password.</Trans></ConfigRow>
                  <ConfigRow name="password" where="string" whereLabel={t`Type`}><Trans>Required when access is <code className={CODE}>PASSWORD</code>. The API never returns it.</Trans></ConfigRow>
                </Table>
                <CodeBlock code={`curl -X POST ${API_BASE}/rooms \\\n  -H "Authorization: Bearer $TAVIO_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name": "Weekly sync"}'`} />
                <p><Trans>Answers 201 with the room:</Trans></p>
                <CodeBlock code={EXAMPLE_ROOM} />
              </Endpoint>
              <Endpoint method="GET" path="/v1/rooms">
                <p><Trans>Lists all rooms of the workspace. <code className={CODE}>activeParticipants</code> counts who is in the room now.</Trans></p>
              </Endpoint>
              <Endpoint method="GET" path="/v1/rooms/{room}">
                <p><Trans>Returns one room.</Trans></p>
              </Endpoint>
              <Endpoint method="DELETE" path="/v1/rooms/{room}">
                <p><Trans>Deletes the room and its past sessions with their filed boards, and answers 204. Recordings stay.</Trans></p>
              </Endpoint>
              <Endpoint method="GET" path="/v1/rooms/{room}/sessions">
                <p><Trans>Lists the room's last 100 meetings, newest first: <code className={CODE}>status</code> (<code className={CODE}>open</code> or <code className={CODE}>closed</code>), <code className={CODE}>startedAt</code>, <code className={CODE}>endedAt</code>, <code className={CODE}>participantNames</code> and <code className={CODE}>messageCount</code>.</Trans></p>
              </Endpoint>
            </div>
          </section>

          <section id="api-recordings" className={SECTION}>
            <h2 className="h-sec"><Trans>Recordings</Trans></h2>
            <div className="space-y-4">
              <Endpoint method="GET" path="/v1/recordings">
                <p><Trans>Lists the workspace's last 100 recordings, newest first. Add <code className={CODE}>{ROOM_FILTER}</code> for one room's recordings. <code className={CODE}>status</code> is <code className={CODE}>starting</code>, <code className={CODE}>recording</code>, <code className={CODE}>completed</code> or <code className={CODE}>failed</code>.</Trans></p>
              </Endpoint>
              <Endpoint method="GET" path="/v1/recordings/{id}">
                <p><Trans>Returns one recording. When the file is stored, <code className={CODE}>downloadUrl</code> holds a link to it that works for 15 minutes; fetch the recording again for a new one.</Trans></p>
                <CodeBlock code={EXAMPLE_RECORDING} />
              </Endpoint>
              <Endpoint method="GET" path="/v1/recordings/{id}/transcript">
                <p><Trans>Returns the transcript: <code className={CODE}>status</code>, the full <code className={CODE}>text</code>, and <code className={CODE}>segments</code> with start and end in milliseconds and a speaker number. Answers 404 while there is none.</Trans></p>
              </Endpoint>
            </div>
          </section>

        </main>

        {/* Right TOC (Hidden on smaller screens) */}
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-64 shrink-0 py-10 pl-10 xl:block">
          <h5 className="mb-4 text-sm font-semibold text-ink"><Trans>On this page</Trans></h5>
          <div className="relative border-l border-rule pl-4 text-sm text-muted [--toc-step:1.75rem] pointer-coarse:[--toc-step:2.75rem]">
             <div
               className="absolute -left-px h-(--toc-step) top-0 w-0.5 bg-ink transition-transform duration-300 ease-standard motion-reduce:transition-none"
               style={{ transform: `translateY(calc(var(--toc-step) * ${tocStep}))` }}
             ></div>
             {SECTIONS.map(({ id, label }) => (
               <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); scrollToSection(id); }} className="link flex h-(--toc-step) items-center">{label}</a>
             ))}
          </div>
        </aside>
      </div>
    </div>
  );
};
