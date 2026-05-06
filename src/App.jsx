import { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';

import { db } from './storage.js';
import {
  DEFAULT_CPT_RULES,
  DEFAULT_CASH_PRICES,
  DEFAULT_INDEMNITY_BENEFITS,
  DEFAULT_REPRICE_FACTORS,
  SCENARIO_PRESETS,
  INPUT_MODES,
  ASSUMPTION_SOURCES,
  INITIAL_PRICING_VERSION,
  INITIAL_RULE_VERSION,
  INITIAL_INDEMNITY_VERSION,
  INITIAL_BENCHMARK_VERSION,
} from './constants.js';
import { normalizeAndClassify } from './engine/classify.js';
import { runCalculation } from './engine/calculate.js';
import { generateSyntheticClaims, decomposePartialSummary } from './engine/synthetic.js';
import { Header } from './ui/Header.jsx';
import { Toast } from './ui/Toast.jsx';
import { SCREENS } from './screens/index.js';
import { CasesScreen } from './screens/CasesScreen.jsx';
import { SetupScreen } from './screens/SetupScreen.jsx';
import { UploadScreen } from './screens/UploadScreen.jsx';
import { ClassifyScreen } from './screens/ClassifyScreen.jsx';
import { ScenarioScreen } from './screens/ScenarioScreen.jsx';
import { DashboardScreen } from './screens/DashboardScreen.jsx';
import { ReportScreen } from './screens/ReportScreen.jsx';
import { AdminScreen } from './screens/AdminScreen.jsx';

export default function App() {
  const [screen, setScreen] = useState(SCREENS.CASES);
  const [employers, setEmployers] = useState([]);
  const [activeEmployerId, setActiveEmployerId] = useState(null);
  const [activeEmployer, setActiveEmployer] = useState(null);
  const [claims, setClaims] = useState([]);
  const [classifiedClaims, setClassifiedClaims] = useState([]);
  const [activeScenario, setActiveScenario] = useState({ ...SCENARIO_PRESETS.expected });
  const [loading, setLoading] = useState(false);
  const [cptRules, setCptRules] = useState(DEFAULT_CPT_RULES);
  const [cashPrices, setCashPrices] = useState(DEFAULT_CASH_PRICES);
  const [indemnityBenefits, setIndemnityBenefits] = useState(DEFAULT_INDEMNITY_BENEFITS);
  const [repriceFactors, setRepriceFactors] = useState(DEFAULT_REPRICE_FACTORS);
  const [toast, setToast] = useState(null);

  const [pricingVersions, setPricingVersions]     = useState([INITIAL_PRICING_VERSION]);
  const [ruleVersions, setRuleVersions]           = useState([INITIAL_RULE_VERSION]);
  const [indemnityVersions, setIndemnityVersions] = useState([INITIAL_INDEMNITY_VERSION]);
  const [benchmarkVersions, setBenchmarkVersions] = useState([INITIAL_BENCHMARK_VERSION]);
  const [auditLog, setAuditLog]                   = useState([]);
  const [inputModeRecord, setInputModeRecord]     = useState(null);

  const activePricingVersion   = pricingVersions.find((v)   => v.status === "active") || INITIAL_PRICING_VERSION;
  const activeRuleVersion      = ruleVersions.find((v)      => v.status === "active") || INITIAL_RULE_VERSION;
  const activeIndemnityVersion = indemnityVersions.find((v) => v.status === "active") || INITIAL_INDEMNITY_VERSION;
  const activeBenchmarkVersion = benchmarkVersions.find((v) => v.status === "active") || INITIAL_BENCHMARK_VERSION;

  useEffect(() => { loadEmployers(); loadVersionsAndAudit(); }, []);

  const loadVersionsAndAudit = async () => {
    const pv = await db.get("global:pricing_versions"); if (pv) setPricingVersions(pv);
    const rv = await db.get("global:rule_versions"); if (rv) setRuleVersions(rv);
    const iv = await db.get("global:indemnity_versions"); if (iv) setIndemnityVersions(iv);
    const bv = await db.get("global:benchmark_versions"); if (bv) setBenchmarkVersions(bv);
    const al = await db.get("global:audit_log"); if (al) setAuditLog(al);
    const cp = await db.get("global:cash_prices"); if (cp) setCashPrices(cp);
    const ib = await db.get("global:indemnity_benefits"); if (ib) setIndemnityBenefits(ib);
    const rf = await db.get("global:reprice_factors"); if (rf) setRepriceFactors(rf);
  };

  const writeAudit = async (entry) => {
    const row = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      actor_user_id: "current_user",
      actor_role: "admin",
      created_at: Date.now(),
      ...entry,
    };
    const next = [row, ...auditLog].slice(0, 500);
    setAuditLog(next);
    await db.set("global:audit_log", next);
  };

  const cutNewVersion = async (kind, mutateFn, changeSummary) => {
    const tables = {
      pricing:    [pricingVersions,   setPricingVersions,   "global:pricing_versions",   "pricing_version"],
      rule:       [ruleVersions,      setRuleVersions,      "global:rule_versions",      "rule_version"],
      indemnity:  [indemnityVersions, setIndemnityVersions, "global:indemnity_versions", "indemnity_version"],
      benchmark:  [benchmarkVersions, setBenchmarkVersions, "global:benchmark_versions", "benchmark_version"],
    };
    const [list, setter, storageKey, entityType] = tables[kind];
    const prior = list.find((v) => v.status === "active");
    const archived = list.map((v) => (v.id === prior?.id ? { ...v, status: "archived" } : v));
    const newId = `${kind.slice(0, 2)}_${Date.now()}`;
    const newVersion = {
      id: newId,
      version_label: new Date().toISOString().slice(0, 10),
      effective_at: Date.now(),
      status: "active",
      change_summary: changeSummary || "Admin update",
      created_by: "current_user",
      created_at: Date.now(),
      ...(kind === "pricing"   ? { price_table: mutateFn() } : {}),
      ...(kind === "rule"      ? { rule_set: mutateFn() } : {}),
      ...(kind === "indemnity" ? { benefit_schedule: mutateFn() } : {}),
      ...(kind === "benchmark" ? { source_documentation: prior?.source_documentation || "" } : {}),
    };
    const next = [newVersion, ...archived];
    setter(next);
    await db.set(storageKey, next);
    await writeAudit({
      action: "create",
      entity_type: entityType,
      entity_id: newId,
      before_state: prior || null,
      after_state: newVersion,
      change_reason: changeSummary || "Admin update",
    });
    return newVersion;
  };

  const showToast = (message, type = "info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadEmployers = async () => {
    setLoading(true);
    const keys = await db.list("employer:");
    const list = [];
    if (Array.isArray(keys)) {
      for (const k of keys) {
        const e = await db.get(k);
        if (e) list.push(e);
      }
    }
    list.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    setEmployers(list);
    setLoading(false);
  };

  const loadEmployer = async (id) => {
    setLoading(true);
    const e = await db.get(`employer:${id}`);
    const c = await db.get(`claims:${id}`) || [];
    const s = await db.get(`scenario:${id}`) || { ...SCENARIO_PRESETS.expected };
    const im = await db.get(`input_mode:${id}`);
    setActiveEmployerId(id);
    setActiveEmployer(e);
    setClaims(c);
    setClassifiedClaims(c.filter((x) => x.bucket));
    setActiveScenario(s);
    setInputModeRecord(im);
    setLoading(false);
  };

  const saveEmployer = async (employer) => {
    await db.set(`employer:${employer.id}`, employer);
    setActiveEmployer(employer);
    await loadEmployers();
  };

  const saveClaims = async (newClaims) => {
    if (!activeEmployerId) return;
    await db.set(`claims:${activeEmployerId}`, newClaims);
    setClaims(newClaims);
    setClassifiedClaims(newClaims.filter((x) => x.bucket));
  };

  const saveScenario = async (scn) => {
    if (!activeEmployerId) return;
    await db.set(`scenario:${activeEmployerId}`, scn);
    setActiveScenario(scn);
  };

  const deleteEmployer = async (id) => {
    await db.delete(`employer:${id}`);
    await db.delete(`claims:${id}`);
    await db.delete(`scenario:${id}`);
    await db.delete(`input_mode:${id}`);
    if (activeEmployerId === id) {
      setActiveEmployerId(null);
      setActiveEmployer(null);
      setClaims([]);
      setClassifiedClaims([]);
      setInputModeRecord(null);
    }
    await loadEmployers();
  };

  const resetAllData = async () => {
    await db.clearAll();
    setEmployers([]);
    setActiveEmployerId(null);
    setActiveEmployer(null);
    setClaims([]);
    setClassifiedClaims([]);
    setInputModeRecord(null);
    setActiveScenario({ ...SCENARIO_PRESETS.expected });
    setCptRules(DEFAULT_CPT_RULES);
    setCashPrices(DEFAULT_CASH_PRICES);
    setIndemnityBenefits(DEFAULT_INDEMNITY_BENEFITS);
    setRepriceFactors(DEFAULT_REPRICE_FACTORS);
    setPricingVersions([INITIAL_PRICING_VERSION]);
    setRuleVersions([INITIAL_RULE_VERSION]);
    setIndemnityVersions([INITIAL_INDEMNITY_VERSION]);
    setBenchmarkVersions([INITIAL_BENCHMARK_VERSION]);
    setAuditLog([]);
    setScreen(SCREENS.CASES);
  };

  const ingestClaims = async (employerId, parsed, meta = {}) => {
    if (!employerId) return null;
    const mode = meta.mode || "full";
    const m = INPUT_MODES[mode.toUpperCase()] || INPUT_MODES.FULL;
    const confidence = meta.confidence || m.confidence;
    const dataSource = meta.data_source || (mode === "full" ? "claims_extract" : mode === "modeled" ? "benchmark" : "broker_report");
    const assumptionSource = mode === "modeled" ? ASSUMPTION_SOURCES.BENCHMARK : ASSUMPTION_SOURCES.ACTUAL;

    const classified = parsed.map((c) => {
      const r = normalizeAndClassify(c, cptRules);
      return {
        ...c,
        normalized_category: r.category,
        bucket: r.bucket,
        bucket_default: r.bucket,
        classification_confidence: r.confidence,
        classification_source: r.source,
        input_mode: mode,
        data_source: dataSource,
        confidence_level: confidence,
        assumption_source: assumptionSource,
        pricing_version_id: activePricingVersion.id,
        rule_version_id: activeRuleVersion.id,
        indemnity_version_id: activeIndemnityVersion.id,
        benchmark_version_id: mode === "modeled" ? activeBenchmarkVersion.id : null,
        manual_override: false,
        override_reason: null,
      };
    });

    const inputModeRow = {
      id: `im_${Date.now()}`,
      employer_id: employerId,
      mode,
      uploaded_file_name: meta.file_name || null,
      row_count: parsed.length,
      claim_lines_total: mode === "full" ? parsed.length : null,
      categories_total: mode === "partial" ? parsed.length : null,
      benchmark_profile_id: mode === "modeled" ? activeBenchmarkVersion.id : null,
      confidence_default: m.confidence,
      confidence_override: meta.confidence_override || null,
      uploaded_by: "current_user",
      uploaded_at: Date.now(),
    };

    await db.set(`input_mode:${employerId}`, inputModeRow);
    await db.set(`claims:${employerId}`, classified);
    setInputModeRecord(inputModeRow);
    setClaims(classified);
    setClassifiedClaims(classified.filter((x) => x.bucket));
    return { classified, inputModeRow, label: m.label };
  };

  const loadDemoCase = async (demoCase) => {
    if (!demoCase) return;
    setLoading(true);
    try {
      const employer = { ...demoCase.employer, created_at: Date.now() };
      await saveEmployer(employer);
      setActiveEmployerId(employer.id);

      const loader = demoCase.loader || {};
      let parsed = [];
      let meta = {};

      if (loader.kind === "json_full") {
        // Frozen pre-rendered claim file. Deterministic across loads.
        let claimsData = [];
        try {
          const resp = await fetch(loader.url, { cache: "no-store" });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          claimsData = await resp.json();
          if (!Array.isArray(claimsData)) throw new Error("expected array");
        } catch (err) {
          showToast(`Couldn't load demo claims: ${err.message}`, "error");
          setLoading(false);
          return;
        }
        parsed = claimsData;
        meta = {
          mode: loader.mode || "full",
          file_name: `[demo] ${loader.url.split("/").pop()}`,
          data_source: loader.data_source || "claims_extract",
          confidence: loader.confidence || "high",
          confidence_override: null,
        };
      } else if (loader.kind === "synthetic_full") {
        const { claims: synth, meta: synthMeta } = generateSyntheticClaims(
          Number(loader.lives) || Number(employer.covered_lives) || 100,
          Number(loader.spend) || Number(employer.historical_claims_spend) || 500000
        );
        parsed = synth.map((c, i) => ({
          ...c,
          employer_id: employer.id,
          employee_id: `E${String((i % Math.max(2, Math.floor(employer.covered_lives / 1.6))) + 1).padStart(4, "0")}`,
          member_relationship: i % 3 === 0 ? "spouse" : i % 5 === 0 ? "child" : "employee",
          member_age: 25 + ((i * 7) % 45),
          member_gender: i % 2 === 0 ? "M" : "F",
          chronic_flag: c.bucket === "E" || (c.allowed_amount || 0) > 5000,
          state: employer.state,
        }));
        meta = {
          mode: "full",
          file_name: `[demo] ${employer.name} synthetic Mode 1.csv`,
          data_source: "claims_extract",
          confidence: "high",
          confidence_override: null,
        };
        if (synthMeta.wasCapped) {
          showToast(`Synthetic dataset capped at ${parsed.length.toLocaleString()} records to protect browser memory`, "info");
        }
      } else if (loader.kind === "csv_partial") {
        let rows = [];
        try {
          const resp = await fetch(loader.url, { cache: "no-store" });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const text = await resp.text();
          const parsedCsv = Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
          });
          rows = parsedCsv.data || [];
        } catch (err) {
          showToast(`Couldn't load demo CSV: ${err.message}`, "error");
          setLoading(false);
          return;
        }
        const dec = decomposePartialSummary(rows, employer.covered_lives);
        parsed = dec.claims;
        meta = {
          mode: "partial",
          file_name: `[demo] ${loader.url.split("/").pop()}`,
          data_source: dec.data_source,
          confidence: dec.confidence,
        };
      } else if (loader.kind === "rows_partial") {
        const rows = Array.isArray(loader.rows) ? loader.rows : [];
        const dec = decomposePartialSummary(rows, employer.covered_lives);
        parsed = dec.claims;
        meta = {
          mode: "partial",
          file_name: `[demo] ${employer.name} category totals`,
          data_source: dec.data_source,
          confidence: dec.confidence,
        };
      } else if (loader.kind === "modeled") {
        const { claims: synth, meta: synthMeta } = generateSyntheticClaims(
          Number(loader.lives) || Number(employer.covered_lives) || 100,
          Number(loader.spend) || Number(employer.historical_claims_spend) || 500000
        );
        parsed = synth;
        meta = {
          mode: "modeled",
          file_name: null,
          data_source: "benchmark",
          confidence: "low",
        };
        if (synthMeta.wasCapped) {
          showToast(`Synthetic dataset capped at ${parsed.length.toLocaleString()} records to protect browser memory`, "info");
        }
      } else {
        showToast(`Unknown demo loader kind: ${loader.kind}`, "error");
        setLoading(false);
        return;
      }

      const ingest = await ingestClaims(employer.id, parsed, meta);

      const scenarioKey = demoCase.scenario || "expected";
      const scn = { ...(SCENARIO_PRESETS[scenarioKey] || SCENARIO_PRESETS.expected) };
      await db.set(`scenario:${employer.id}`, scn);
      setActiveScenario(scn);

      const dest = (demoCase.destination || "dashboard").toLowerCase();
      const screenMap = {
        dashboard: SCREENS.DASHBOARD,
        upload:    SCREENS.UPLOAD,
        classify:  SCREENS.CLASSIFY,
        scenario:  SCREENS.SCENARIO,
        report:    SCREENS.REPORT,
      };
      setScreen(screenMap[dest] || SCREENS.DASHBOARD);
      showToast(
        `Demo case loaded · ${employer.name} (${ingest?.label || "—"}) · ${ingest?.classified?.length?.toLocaleString() || 0} claim lines`,
        "success"
      );
    } finally {
      setLoading(false);
    }
  };

  const result = useMemo(() => {
    if (!classifiedClaims.length) return null;
    return runCalculation(classifiedClaims, activeScenario, cashPrices, indemnityBenefits, repriceFactors);
  }, [classifiedClaims, activeScenario, cashPrices, indemnityBenefits, repriceFactors]);

  return (
    <div style={{ fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}
         className="min-h-screen bg-stone-50 text-stone-900">
      <Header
        screen={screen}
        setScreen={setScreen}
        activeEmployer={activeEmployer}
        clearEmployer={() => {
          setActiveEmployerId(null);
          setActiveEmployer(null);
          setClaims([]);
          setClassifiedClaims([]);
          setScreen(SCREENS.CASES);
        }}
      />

      <main className="max-w-7xl mx-auto px-6 py-8">
        {screen === SCREENS.CASES && (
          <CasesScreen
            employers={employers}
            loading={loading}
            onOpen={async (id) => { await loadEmployer(id); setScreen(SCREENS.UPLOAD); }}
            onCreateNew={() => setScreen(SCREENS.SETUP)}
            onDelete={deleteEmployer}
            onLoadDemo={loadDemoCase}
            onResetAll={resetAllData}
            isPersistent={db.isPersistent()}
          />
        )}
        {screen === SCREENS.SETUP && (
          <SetupScreen
            initial={activeEmployer}
            onSave={async (emp) => {
              await saveEmployer(emp);
              setActiveEmployerId(emp.id);
              setScreen(SCREENS.UPLOAD);
              showToast("Employer case saved", "success");
            }}
          />
        )}
        {screen === SCREENS.UPLOAD && (
          <UploadScreen
            employer={activeEmployer}
            existingClaims={claims}
            cptRules={cptRules}
            inputModeRecord={inputModeRecord}
            onClaimsLoaded={async (parsed, meta = {}) => {
              const ingest = await ingestClaims(activeEmployerId, parsed, meta);
              if (ingest) {
                showToast(`${ingest.classified.length.toLocaleString()} claim records ingested · ${ingest.label}`, "success");
                setScreen(SCREENS.CLASSIFY);
              }
            }}
            onSyntheticGenerate={async (lives, spend) => {
              const { claims: synth, meta: synthMeta } = generateSyntheticClaims(lives, spend);
              const ingest = await ingestClaims(activeEmployerId, synth, {
                mode: "modeled",
                data_source: "benchmark",
                confidence: "low",
              });
              if (ingest) {
                const cappedNote = synthMeta.wasCapped
                  ? ` (capped from ${synthMeta.requestedClaims.toLocaleString()} to protect browser memory)`
                  : "";
                showToast(`Modeled dataset built · ${ingest.classified.length.toLocaleString()} synthetic lines${cappedNote}`, "success");
                setScreen(SCREENS.CLASSIFY);
              }
            }}
            showToast={showToast}
          />
        )}
        {screen === SCREENS.CLASSIFY && (
          <ClassifyScreen
            claims={classifiedClaims}
            onUpdateClaim={async (claim_id, updates, reason, kind = "bucket") => {
              const before = classifiedClaims.find((c) => c.claim_id === claim_id);
              const next = classifiedClaims.map((c) => {
                if (c.claim_id !== claim_id) return c;
                if (kind === "exclude") {
                  return { ...c, ...updates, exclude_reason: reason || c.exclude_reason || "User-excluded from analysis" };
                }
                return { ...c, ...updates, manual_override: true, override_reason: reason || c.override_reason || "User reclassification" };
              });
              await saveClaims(next);
              await writeAudit({
                action: "update",
                entity_type: kind === "exclude" ? "claim_inclusion" : "manual_override",
                entity_id: claim_id,
                before_state: before,
                after_state: next.find((c) => c.claim_id === claim_id),
                change_reason: reason || (kind === "exclude" ? "Toggle inclusion" : "Manual claim reclassification"),
              });
            }}
            onBulkUpdate={async (claim_ids, updates, reason) => {
              const idSet = new Set(claim_ids);
              const next = classifiedClaims.map((c) =>
                idSet.has(c.claim_id) ? { ...c, ...updates } : c);
              await saveClaims(next);
              await writeAudit({
                action: "bulk_update",
                entity_type: "claim_inclusion",
                entity_id: `${claim_ids.length} claims`,
                before_state: null,
                after_state: null,
                change_reason: reason || `Bulk update on ${claim_ids.length} claims`,
              });
            }}
          />
        )}
        {screen === SCREENS.SCENARIO && (
          <ScenarioScreen
            scenario={activeScenario}
            onChange={saveScenario}
            onPreset={async (key) => { await saveScenario({ ...SCENARIO_PRESETS[key] }); }}
          />
        )}
        {screen === SCREENS.DASHBOARD && (
          <DashboardScreen
            employer={activeEmployer}
            scenario={activeScenario}
            result={result}
            classifiedClaims={classifiedClaims}
            inputModeRecord={inputModeRecord}
            activePricingVersion={activePricingVersion}
            activeRuleVersion={activeRuleVersion}
            activeIndemnityVersion={activeIndemnityVersion}
            activeBenchmarkVersion={activeBenchmarkVersion}
            onScenarioChange={saveScenario}
          />
        )}
        {screen === SCREENS.REPORT && (
          <ReportScreen
            employer={activeEmployer}
            scenario={activeScenario}
            result={result}
            classifiedClaims={classifiedClaims}
            inputModeRecord={inputModeRecord}
            activePricingVersion={activePricingVersion}
            activeRuleVersion={activeRuleVersion}
            activeIndemnityVersion={activeIndemnityVersion}
            activeBenchmarkVersion={activeBenchmarkVersion}
          />
        )}
        {screen === SCREENS.ADMIN && (
          <AdminScreen
            cptRules={cptRules}
            cashPrices={cashPrices}
            indemnityBenefits={indemnityBenefits}
            repriceFactors={repriceFactors}
            pricingVersions={pricingVersions}
            ruleVersions={ruleVersions}
            indemnityVersions={indemnityVersions}
            benchmarkVersions={benchmarkVersions}
            auditLog={auditLog}
            onUpdateCashPrices={async (next, reason) => {
              setCashPrices(next);
              await db.set("global:cash_prices", next);
              await cutNewVersion("pricing", () => next, reason || "Cash-pay table updated");
              showToast("New pricing version created", "success");
            }}
            onUpdateIndemnity={async (next, reason) => {
              setIndemnityBenefits(next);
              await db.set("global:indemnity_benefits", next);
              await cutNewVersion("indemnity", () => next, reason || "Indemnity schedule updated");
              showToast("New indemnity version created", "success");
            }}
            onUpdateRepriceFactors={async (next, reason) => {
              setRepriceFactors(next);
              await db.set("global:reprice_factors", next);
              await cutNewVersion("rule", () => ({ cpt_rules: cptRules, reprice_factors: next }), reason || "Repricing factors updated");
              showToast("New rule version created", "success");
            }}
          />
        )}
      </main>

      {toast && <Toast {...toast} />}
    </div>
  );
}
