import { Upload, Database, Sliders, BarChart3, FileDown, Layers, Settings } from 'lucide-react';
import { SCREENS } from '../screens/index.js';

export function Header({ screen, setScreen, activeEmployer, clearEmployer }) {
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
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={clearEmployer} className="flex items-center gap-3 group">
            <div className="w-8 h-8 bg-stone-900 text-stone-50 rounded grid place-items-center">
              <Layers size={16} strokeWidth={2.5} />
            </div>
            <div className="leading-tight">
              <div className="font-display text-xl">OffPlan</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-medium">
                Reclassification Engine
              </div>
            </div>
          </button>
          {activeEmployer && (
            <>
              <div className="h-8 w-px bg-stone-200 mx-2" />
              <div className="text-sm">
                <div className="text-stone-500 text-[10px] uppercase tracking-wider">Active case</div>
                <div className="font-medium text-stone-900">{activeEmployer.name}</div>
              </div>
            </>
          )}
        </div>

        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setScreen(item.id)}
              className={`flex items-center gap-2 px-3 h-9 text-sm rounded transition ${
                screen === item.id
                  ? "bg-stone-900 text-white"
                  : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <span
                className={`text-[10px] font-mono num leading-none w-4 text-center ${
                  screen === item.id ? "text-stone-400" : "text-stone-400"
                }`}
              >
                {item.step}
              </span>
              <item.icon size={14} />
              {item.label}
            </button>
          ))}
          <button
            onClick={() => setScreen(SCREENS.ADMIN)}
            className={`ml-2 flex items-center gap-2 px-3 h-9 text-sm rounded transition ${
              screen === SCREENS.ADMIN ? "bg-stone-900 text-white" : "text-stone-600 hover:bg-stone-100"
            }`}
          >
            <Settings size={14} />
            Admin
          </button>
        </nav>
      </div>
    </header>
  );
}
