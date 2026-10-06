import { useEffect, useState } from 'react';
import { NavContext, type Route } from './nav';
import { useData } from './store';
import { HomePage } from './pages/Home';
import { PlayPage } from './pages/Play';
import { TrainPage } from './pages/Train';
import { LearnPage } from './pages/Learn';
import { StrategyPage } from './pages/Strategy';
import { AnalyzePage } from './pages/Analyze';
import { ToolsPage } from './pages/Tools';
import { SettingsPage } from './pages/Settings';
import { AccountPage, statusText } from './pages/Account';
import { useCloud } from '../cloud/cloud';
import { STORAGE_OK } from './store';
import { useSpcWatch, spcAlert, SPC_SITE } from '../cloud/spcWatch';

const TABS: { page: Route['page']; label: string }[] = [
  { page: 'home', label: 'Home' }, { page: 'play', label: 'Play' }, { page: 'train', label: 'Train' }, { page: 'learn', label: 'Learn' },
  { page: 'strategy', label: 'Strategy' }, { page: 'analyze', label: 'Analyze' }, { page: 'tools', label: 'Tools' }, { page: 'settings', label: 'Settings' },
];

function routeFromHash(): Route {
  try {
    const h = window.location.hash.replace(/^#/, '');
    const [page, a] = h.split('.');
    if (!page) return { page: 'home' };
    if (page === 'train') return { page, drill: a as never };
    if (page === 'learn') return { page, lesson: a as never };
    if (page === 'strategy' || page === 'tools' || page === 'analyze') return { page, tab: a } as Route;
    if (TABS.some((t) => t.page === page) || page === 'account') return { page } as Route;
  } catch { /* ignore */ }
  return { page: 'home' };
}

function hashOf(r: Route): string {
  const extra = 'drill' in r ? r.drill : 'lesson' in r ? r.lesson : 'tab' in r ? r.tab : undefined;
  return r.page === 'home' ? '' : `#${r.page}${extra ? '.' + extra : ''}`;
}

export function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const { settings } = useData();
  const cloud = useCloud();
  const nav = (r: Route) => {
    setRoute(r);
    try { history.pushState(null, '', hashOf(r) || window.location.pathname + window.location.search); } catch { /* sandboxed */ }
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => { window.removeEventListener('hashchange', onHash); window.removeEventListener('popstate', onHash); };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);
  let page;
  switch (route.page) {
    case 'play': page = <PlayPage preset={route.preset} />; break;
    case 'train': page = <TrainPage drill={route.drill} />; break;
    case 'learn': page = <LearnPage lesson={route.lesson} />; break;
    case 'strategy': page = <StrategyPage tab={route.tab} />; break;
    case 'analyze': page = <AnalyzePage tab={route.tab} hand={route.hand} move={route.move} />; break;
    case 'tools': page = <ToolsPage tab={route.tab} />; break;
    case 'settings': page = <SettingsPage />; break;
    case 'account': page = <AccountPage />; break;
    default: page = <HomePage />;
  }
  return (
    <NavContext.Provider value={nav}>
      <header className="topbar">
        <div className="topbar-inner">
          <button className="brand" onClick={() => nav({ page: 'home' })} aria-label="MTT Coach home">
            <span className="brand-mark" aria-hidden="true">♠</span>MTT Coach
          </button>
          <nav className="nav" aria-label="Main">
            {TABS.map((t) => <button key={t.page} className={route.page === t.page ? 'active' : ''} onClick={() => nav({ page: t.page } as Route)}>{t.label}</button>)}
          </nav>
          <AccountChip active={route.page === 'account'} onClick={() => nav({ page: 'account' })} />
        </div>
      </header>
      {!STORAGE_OK && (
        <div className="storage-warning" role="alert">
          This browser isn’t saving your progress (private mode or blocked site data).{cloud.available ? ' Sign in to keep it in the cloud.' : ' Use a normal window to keep it.'}
        </div>
      )}
      <SpcBanner />
      <main>{page}</main>
    </NavContext.Provider>
  );
}

const DISMISS_KEY = 'mttcoach.spcDismissed';

/** Shown when the SPC watcher sees registration open, or the SPC site changed in the last few days. */
function SpcBanner() {
  const w = useSpcWatch();
  const alert = spcAlert(w);
  const key = `${alert}:${w?.lastAlert?.at ?? ''}`;
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(DISMISS_KEY); } catch { return null; } });
  if (!alert || dismissed === key) return null;
  const dismiss = () => { setDismissed(key); try { localStorage.setItem(DISMISS_KEY, key); } catch { /* ignore */ } };
  return (
    <div className={`spc-banner ${alert}`} role="status">
      <span>{alert === 'open'
        ? <><strong>SPC XXIII registration looks open.</strong> Register for the December 18–20 event on the SPC website.</>
        : <><strong>The SPC website changed.</strong> Check whether SPC XXIII registration has opened.</>}</span>
      <a className="btn small primary" href={SPC_SITE} target="_blank" rel="noreferrer">Open sgpokerchamps.com</a>
      <button className="btn small ghost" onClick={dismiss} aria-label="Dismiss">Dismiss</button>
    </div>
  );
}

function AccountChip({ active, onClick }: { active: boolean; onClick: () => void }) {
  const cloud = useCloud();
  if (!cloud.available) return null;
  if (!cloud.user) return <button className={`btn small ${active ? '' : 'primary'}`} onClick={onClick}>Sign in</button>;
  return (
    <button className={`account-chip ${cloud.status}`} onClick={onClick} title={statusText(cloud)} aria-label={`Account: ${cloud.user.username}, ${statusText(cloud)}`}>
      <span className="dot" aria-hidden="true" />
      <span className="who">{cloud.user.username}</span>
    </button>
  );
}
