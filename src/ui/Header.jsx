import { Upload, Database, Sliders, BarChart3, FileDown, Layers, Settings, BookOpen } from 'lucide-react';
import { SCREENS } from '../screens/index.js';

export function Header({ screen, setScreen, activeEmployer, clearEmployer, onShowShortcuts }) {
  // Numbered to give the user a clear sense of progression through the
  // typical analysis flow. Setup is implicitly step 1 (the Cases entry
  // point handles employer selection / setup); the post-setup workflow
  // numbers from there.
  const navItems = activeEmployer ? [
    { id: SCREENS.UPLOAD,    step: 1, label: "Data",      icon: Upload },
    { id: SCREENS.CLASSIFY,  step: 2, label: "Classify",  icon: Database },
    { id: SCREENS.SCENARIO,  step: 3, label: "Scenario",  icon: Sliders },
    { id: SCREENS.DASHBOARD, step: 4, label: "Dashboard", icon: BarChart3 },
    { id: SCREENS.REPORT,    step: 5, label: "Report",    icon: FileDown },
  ] : [];

  return (
    <header className="border-b border-stone-200 bg-white sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 md:px-6 min-h-16 flex flex-wrap items-center justify-between gap-y-2 py-2 md:py-0">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <button onClick={clearEmployer} className="flex items-center gap-2 md:gap-3 group shrink-0">
            <div className="w-8 h-8 bg-stone-900 text-stone-50 rounded grid place-items-center">
              <Layers size={16} strokeWidth={2.5} />
            </div>
            <div className="leading-tight">
              <div className="font-display text-xl">OffPlan</div>
              <div className="hidden sm:block text-[10px] uppercase tracking-[0.18em] text-stone-500 font-medium">
                Reclassification Engine
              </div>
            </div>
          </button>
          {activeEmployer && (
            <>
              <div className="hidden sm:block h-8 w-px bg-stone-200 mx-1" />
              <div className="text-sm min-w-0">
                <div className="hidden sm:block text-stone-500 text-[10px] uppercase tracking-wider">Active case</div>
                <div className="font-medium text-stone-900 truncate max-w-[10rem] md:max-w-none">{activeEmployer.name}</div>
              </div>
            </>
          )}
        </div>

        <nav className="flex items-center gap-1 flex-wrap">
          {navItems.map((item) => {
            const active = screen === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setScreen(item.id)}
                title={`${item.step}. ${item.label}`}
                className={`flex items-center gap-1.5 md:gap-2 px-2 md:px-3 h-9 text-sm rounded transition ${
                  active ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
                }`}
              >
                <span className="text-[10px] font-mono num leading-none w-4 text-center text-stone-400">
                  {item.step}
                </span>
                <item.icon size={14} />
                <span className="hidden md:inline">{item.label}</span>
              </button>
            );
          })}
          <button
            onClick={() => setScreen(SCREENS.OVERVIEW)}
            title="What OffPlan does (O)"
            className={`ml-1 md:ml-2 flex items-center gap-1.5 md:gap-2 px-2 md:px-3 h-9 text-sm rounded transition ${
              screen === SCREENS.OVERVIEW ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            <BookOpen size={14} />
            <span className="hidden md:inline">Overview</span>
          </button>
          <button
            onClick={() => setScreen(SCREENS.ADMIN)}
            title="Admin"
            className={`ml-1 flex items-center gap-1.5 md:gap-2 px-2 md:px-3 h-9 text-sm rounded transition ${
              screen === SCREENS.ADMIN ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            <Settings size={14} />
            <span className="hidden md:inline">Admin</span>
          </button>
          {onShowShortcuts && (
            <button
              onClick={onShowShortcuts}
              title="Keyboard shortcuts (?)"
              className="ml-1 w-8 h-8 grid place-items-center text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded transition text-sm"
            >
              <kbd className="font-mono text-xs">?</kbd>
            </button>
          )}
        </nav>
      </div>
    </header>
  );
}
