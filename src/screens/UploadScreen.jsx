import { useState, useRef } from 'react';
import Papa from 'papaparse';
import { Upload, AlertCircle, Database, Download } from 'lucide-react';
import { Field } from '../ui/Field.jsx';
import { fmtUSD } from '../ui/formatters.js';
import { INPUT_MODES } from '../constants.js';
import { decomposePartialSummary, SYNTHETIC_DISTRIBUTION } from '../engine/synthetic.js';
import { SAMPLE_CSV_FILES } from '../demo-cases.js';

export function UploadScreen({ employer, existingClaims, onClaimsLoaded, onSyntheticGenerate, showToast, inputModeRecord }) {
  const [mode, setMode] = useState(existingClaims.length ? "current" : "");
  const [parseErrors, setParseErrors] = useState([]);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef();

  const REQUIRED_FIELDS = ["claim_id", "member_id", "service_date", "allowed_amount", "place_of_service"];
  const PARTIAL_REQUIRED = ["claims_category", "annual_spend", "covered_lives", "data_source", "confidence_level"];

  const handleFullClaimsFile = (file) => {
    setParsing(true);
    setParseErrors([]);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (results) => {
        const rows = results.data;
        const errors = [];

        if (rows.length === 0) errors.push("File is empty.");
        else {
          const missingHeaders = REQUIRED_FIELDS.filter((f) => !(f in rows[0]));
          if (missingHeaders.length) errors.push(`Missing required columns: ${missingHeaders.join(", ")}`);
        }

        const validRows = [];
        rows.forEach((row, i) => {
          const rowNum = i + 2;
          if (!row.claim_id) { errors.push(`Row ${rowNum}: missing claim_id`); return; }
          if (!row.member_id) { errors.push(`Row ${rowNum}: missing member_id`); return; }
          const allowed = parseFloat(row.allowed_amount);
          if (isNaN(allowed) || allowed < 0) { errors.push(`Row ${rowNum}: invalid allowed_amount`); return; }
          row.allowed_amount = allowed;
          row.paid_amount = parseFloat(row.paid_amount) || 0;
          validRows.push(row);
        });

        if (errors.length > 5) setParseErrors([...errors.slice(0, 5), `... and ${errors.length - 5} more issues.`]);
        else setParseErrors(errors);

        if (validRows.length > 0 && errors.length < rows.length) {
          onClaimsLoaded(validRows, { mode: "full", file_name: file.name, data_source: "claims_extract" });
        }
        setParsing(false);
      },
      error: (err) => { setParseErrors([`Parse error: ${err.message}`]); setParsing(false); },
    });
  };

  const handlePartialSummaryFile = (file) => {
    setParsing(true);
    setParseErrors([]);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, "_"),
      complete: (results) => {
        const rows = results.data;
        const errors = [];

        if (rows.length === 0) errors.push("File is empty.");
        else {
          const missingHeaders = PARTIAL_REQUIRED.filter((f) => !(f in rows[0]));
          if (missingHeaders.length) errors.push(`Missing required columns: ${missingHeaders.join(", ")}`);
        }

        const dec = decomposePartialSummary(rows, employer?.covered_lives);
        errors.push(...dec.errors);

        if (errors.length > 5) setParseErrors([...errors.slice(0, 5), `... and ${errors.length - 5} more issues.`]);
        else setParseErrors(errors);

        if (dec.claims.length > 0) {
          onClaimsLoaded(dec.claims, {
            mode: "partial",
            file_name: file.name,
            data_source: dec.data_source,
            confidence: dec.confidence,
          });
        }
        setParsing(false);
      },
      error: (err) => { setParseErrors([`Parse error: ${err.message}`]); setParsing(false); },
    });
  };

  const loadSampleFile = async (which) => {
    const sample = SAMPLE_CSV_FILES[which];
    if (!sample) {
      showToast(`No bundled sample for "${which}"`, "error");
      return;
    }
    setParsing(true);
    setParseErrors([]);
    try {
      const resp = await fetch(sample.url, { cache: "no-store" });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const blob = new Blob([text], { type: "text/csv" });
      const file = new File([blob], sample.url.split("/").pop(), { type: "text/csv" });
      if (which === "full") handleFullClaimsFile(file);
      else if (which === "partial") handlePartialSummaryFile(file);
      else { showToast(`Sample "${which}" not supported`, "error"); setParsing(false); }
    } catch (err) {
      showToast(`Couldn't load sample: ${err.message}`, "error");
      setParsing(false);
    }
  };

  return (
    <div>
      <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Claims Data</h1>
      <p className="text-stone-600 mb-8 max-w-2xl">
        Three input modes. The engine adapts to the data you have. Every record carries its provenance through the rest of the analysis.
      </p>

      {existingClaims.length > 0 && mode === "current" && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-5 mb-6 flex items-center justify-between">
          <div>
            <div className="font-medium text-emerald-900 flex items-center gap-2">
              {existingClaims.length.toLocaleString()} records loaded for {employer?.name}
              {inputModeRecord && (
                <span className="bg-white border border-emerald-300 text-emerald-800 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded">
                  {INPUT_MODES[inputModeRecord.mode?.toUpperCase()]?.label || inputModeRecord.mode}
                </span>
              )}
            </div>
            <div className="text-sm text-emerald-700 mt-0.5">
              Total allowed: {fmtUSD(existingClaims.reduce((s, c) => s + (Number(c.allowed_amount) || 0), 0))}
            </div>
          </div>
          <button onClick={() => setMode("")} className="text-sm text-emerald-700 hover:text-emerald-900 underline">
            Replace data
          </button>
        </div>
      )}

      {(mode !== "current" || existingClaims.length === 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <ModeCard
            active={mode === "full"}
            onClick={() => setMode("full")}
            badge="Mode 1"
            title="Full Claims"
            description="CPT-level detail. Self-funded employers, broker reports, TPA exports."
            confidence="High confidence"
            confColor="emerald"
          />
          <ModeCard
            active={mode === "summary"}
            onClick={() => setMode("summary")}
            badge="Mode 2"
            title="Partial Summary"
            description="Category-level totals from broker, carrier, or PBM reports."
            confidence="Medium confidence"
            confColor="amber"
          />
          <ModeCard
            active={mode === "modeled"}
            onClick={() => setMode("modeled")}
            badge="Mode 3"
            title="Modeled Profile"
            description="No claims data. Synthesized from benchmark profile."
            confidence="Low confidence · Illustrative"
            confColor="rose"
          />
        </div>
      )}

      {mode === "full" && (
        <FullClaimsUpload
          fileRef={fileRef}
          onFile={handleFullClaimsFile}
          onLoadSample={() => loadSampleFile("full")}
          parsing={parsing}
          errors={parseErrors}
        />
      )}

      {mode === "summary" && (
        <PartialSummaryUpload
          employer={employer}
          onFile={handlePartialSummaryFile}
          onLoadSample={() => loadSampleFile("partial")}
          onManualSubmit={(claims, meta) => onClaimsLoaded(claims, { mode: "partial", ...meta })}
          parsing={parsing}
          errors={parseErrors}
          showToast={showToast}
        />
      )}

      {mode === "modeled" && (
        <ModeledInput employer={employer} onGenerate={onSyntheticGenerate} />
      )}
    </div>
  );
}

function ModeCard({ active, onClick, badge, title, description, confidence, confColor = "emerald" }) {
  const palette = {
    emerald: active ? "text-emerald-300" : "text-emerald-700",
    amber:   active ? "text-amber-300"   : "text-amber-700",
    rose:    active ? "text-rose-300"    : "text-rose-700",
  };
  return (
    <button
      onClick={onClick}
      className={`text-left p-5 rounded-lg border transition ${
        active ? "bg-stone-900 text-white border-stone-900" : "bg-white border-stone-200 hover:border-stone-400"
      }`}
    >
      <div className={`text-[10px] uppercase tracking-wider mb-3 ${active ? "text-stone-400" : "text-stone-500"}`}>
        {badge}
      </div>
      <h3 className="font-display text-2xl mb-2">{title}</h3>
      <p className={`text-sm mb-4 ${active ? "text-stone-300" : "text-stone-600"}`}>{description}</p>
      <div className={`text-xs font-medium ${palette[confColor] || palette.emerald}`}>
        {confidence}
      </div>
    </button>
  );
}

function FullClaimsUpload({ fileRef, onFile, onLoadSample, parsing, errors }) {
  const downloadTemplate = () => {
    const headers = "claim_id,employer_id,member_id,employee_id,member_relationship,member_age,member_gender,service_date,paid_date,claim_type,place_of_service,provider_specialty,facility_type,cpt_code,hcpcs_code,icd10_primary,icd10_secondary,revenue_code,drg_code,allowed_amount,paid_amount,member_oop_amount,units,provider_npi,provider_zip3,state,notes";
    const example = "CLM000001,EMP_TEST_001,M0001,E001,employee,47,F,2025-04-15,2025-05-12,Professional,Office,Family Medicine,Clinic,99213,,I10,E119,,,185,155,30,1,1234567890,331,FL,Primary Care";
    const blob = new Blob([headers + "\n" + example + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "offplan_claims_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-8">
      <div className="border-2 border-dashed border-stone-200 rounded-lg p-12 text-center"
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}>
        <div className="w-12 h-12 bg-stone-100 rounded-full grid place-items-center mx-auto mb-4">
          <Upload size={20} className="text-stone-700" />
        </div>
        <h3 className="font-display text-2xl mb-1">Upload Claims CSV</h3>
        <p className="text-sm text-stone-600 mb-6">Drag a file here, or click to browse.</p>
        <div className="flex justify-center gap-3 flex-wrap">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={parsing}
            className="bg-stone-900 text-white px-5 h-10 rounded font-medium hover:bg-stone-800 disabled:opacity-50"
          >
            {parsing ? "Parsing..." : "Choose File"}
          </button>
          {onLoadSample && (
            <button
              onClick={onLoadSample}
              disabled={parsing}
              className="border border-stone-300 px-5 h-10 rounded font-medium hover:bg-stone-50 flex items-center gap-2 disabled:opacity-50"
              title="Load the bundled v2.1 sample claims CSV"
            >
              <Database size={14} /> Use sample CSV
            </button>
          )}
          <button
            onClick={downloadTemplate}
            className="border border-stone-300 px-5 h-10 rounded font-medium hover:bg-stone-50 flex items-center gap-2"
          >
            <Download size={14} /> Template
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}
        />
        <p className="text-xs text-stone-500 mt-6">
          Required: claim_id · member_id · service_date · allowed_amount · place_of_service
        </p>
      </div>

      {errors.length > 0 && (
        <div className="mt-6 bg-amber-50 border border-amber-200 rounded p-4">
          <div className="flex gap-2">
            <AlertCircle size={16} className="text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-amber-900 mb-1">Validation issues</div>
              {errors.map((e, i) => <div key={i} className="text-sm text-amber-800">{e}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PartialSummaryUpload({ employer, onFile, onLoadSample, onManualSubmit, parsing, errors, showToast }) {
  const [subMode, setSubMode] = useState("csv");
  const fileRef = useRef();

  const downloadTemplate = () => {
    const headers = "employer_id,claims_category,annual_spend,claim_count,covered_lives,data_source,confidence_level,period_start,period_end,notes";
    const examples = [
      `${employer?.id || "EMP_001"},Primary Care,82000,612,${employer?.covered_lives || 162},broker_report,medium,2025-01-01,2025-12-31,From broker renewal packet`,
      `${employer?.id || "EMP_001"},Specialty Care,148000,287,${employer?.covered_lives || 162},broker_report,medium,2025-01-01,2025-12-31,`,
      `${employer?.id || "EMP_001"},Imaging,94000,72,${employer?.covered_lives || 162},broker_report,high,2025-01-01,2025-12-31,Confirmed against carrier`,
      `${employer?.id || "EMP_001"},ER,68000,41,${employer?.covered_lives || 162},broker_report,medium,2025-01-01,2025-12-31,`,
      `${employer?.id || "EMP_001"},Inpatient,295000,12,${employer?.covered_lives || 162},carrier_summary,high,2025-01-01,2025-12-31,Two large admits`,
    ].join("\n");
    const blob = new Blob([headers + "\n" + examples + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "offplan_partial_summary_template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex border border-stone-200 rounded overflow-hidden mb-6 inline-flex">
        {[
          { id: "csv", label: "Upload CSV" },
          { id: "manual", label: "Enter Manually" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setSubMode(t.id)}
            className={`px-4 h-10 text-sm font-medium ${
              subMode === t.id ? "bg-stone-900 text-white" : "bg-white text-stone-700 hover:bg-stone-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {subMode === "csv" && (
        <div className="bg-white border border-stone-200 rounded-lg p-8">
          <div className="border-2 border-dashed border-stone-200 rounded-lg p-12 text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); }}>
            <div className="w-12 h-12 bg-stone-100 rounded-full grid place-items-center mx-auto mb-4">
              <Upload size={20} className="text-stone-700" />
            </div>
            <h3 className="font-display text-2xl mb-1">Upload Partial Summary CSV</h3>
            <p className="text-sm text-stone-600 mb-6">One row per category. Drag a file here, or click to browse.</p>
            <div className="flex justify-center gap-3 flex-wrap">
              <button onClick={() => fileRef.current?.click()} disabled={parsing}
                className="bg-stone-900 text-white px-5 h-10 rounded font-medium hover:bg-stone-800 disabled:opacity-50">
                {parsing ? "Parsing..." : "Choose File"}
              </button>
              {onLoadSample && (
                <button onClick={onLoadSample} disabled={parsing}
                  className="border border-stone-300 px-5 h-10 rounded font-medium hover:bg-stone-50 flex items-center gap-2 disabled:opacity-50"
                  title="Load the bundled v2.1 sample partial-summary CSV">
                  <Database size={14} /> Use sample CSV
                </button>
              )}
              <button onClick={downloadTemplate}
                className="border border-stone-300 px-5 h-10 rounded font-medium hover:bg-stone-50 flex items-center gap-2">
                <Download size={14} /> Template
              </button>
            </div>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => e.target.files[0] && onFile(e.target.files[0])} />
            <p className="text-xs text-stone-500 mt-6">
              Required: claims_category · annual_spend · covered_lives · data_source · confidence_level
            </p>
          </div>

          {errors.length > 0 && (
            <div className="mt-6 bg-amber-50 border border-amber-200 rounded p-4">
              <div className="flex gap-2">
                <AlertCircle size={16} className="text-amber-700 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium text-amber-900 mb-1">Validation issues</div>
                  {errors.map((e, i) => <div key={i} className="text-sm text-amber-800">{e}</div>)}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {subMode === "manual" && (
        <SummaryClaimsInput
          employer={employer}
          onSubmit={(claims, meta) => onManualSubmit(claims, meta)}
          showToast={showToast}
        />
      )}
    </div>
  );
}

function SummaryClaimsInput({ employer, onSubmit, showToast }) {
  const [totals, setTotals] = useState({
    "Primary Care": "",
    "Specialty Care": "",
    "Imaging": "",
    "Lab": "",
    "Procedures": "",
    "ER": "",
    "Urgent Care": "",
    "Outpatient Surgery": "",
    "Inpatient": "",
    "Pharmacy": "",
    "Other": "",
  });
  const [dataSource, setDataSource] = useState("broker_report");
  const [confidence, setConfidence] = useState("medium");

  const total = Object.values(totals).reduce((s, v) => s + (Number(v) || 0), 0);

  const submit = () => {
    if (!total) { showToast("Enter at least one category total", "error"); return; }
    const claims = [];
    let seq = 1;
    const lives = Number(employer?.covered_lives) || 100;
    Object.entries(totals).forEach(([category, value]) => {
      const v = Number(value) || 0;
      if (v <= 0) return;
      const rep = SYNTHETIC_DISTRIBUTION.find(([cat]) => cat.toLowerCase() === category.toLowerCase());
      if (!rep) return;
      const [, , , avgSize, cpt, pos] = rep;
      const count = Math.max(1, Math.round(v / avgSize));
      const claimSize = v / count;
      for (let i = 0; i < count; i++) {
        const memberId = `M${String((seq % Math.max(2, lives)) + 1).padStart(4, "0")}`;
        claims.push({
          claim_id: `CLM_PART_${String(seq).padStart(6, "0")}`,
          member_id: memberId,
          service_date: "2025-06-15",
          cpt_code: cpt,
          place_of_service: pos,
          provider_specialty: category === "Primary Care" ? "Family Medicine" : "",
          claim_type: category === "Pharmacy" ? "Rx" : category === "Inpatient" ? "Facility" : "Professional",
          allowed_amount: claimSize,
          drg_code: category === "Inpatient" ? "291" : "",
          _from_summary: true,
          _summary_category: category,
        });
        seq++;
      }
    });
    onSubmit(claims, { data_source: dataSource, confidence });
  };

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-8">
      <h3 className="font-display text-2xl mb-2">Category Totals</h3>
      <p className="text-stone-600 text-sm mb-6">
        Enter total allowed spend by category. The engine decomposes each total into representative claim lines using national benchmarks.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Field label="Data Source">
          <select value={dataSource} onChange={(e) => setDataSource(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900">
            <option value="broker_report">Broker report</option>
            <option value="carrier_summary">Carrier summary</option>
            <option value="pbm_report">PBM report</option>
            <option value="self_reported">Self-reported by employer</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Confidence Level">
          <select value={confidence} onChange={(e) => setConfidence(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 text-stone-900 focus:outline-none focus:border-stone-900">
            <option value="high">High · Confirmed against source</option>
            <option value="medium">Medium · Best estimate</option>
            <option value="low">Low · Rough placeholder</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        {Object.keys(totals).map((cat) => (
          <Field key={cat} label={cat}>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm">$</span>
              <input
                type="number"
                value={totals[cat]}
                onChange={(e) => setTotals({ ...totals, [cat]: e.target.value })}
                placeholder="0"
                className="w-full bg-stone-50 border border-stone-200 rounded pl-6 pr-3 h-10 font-mono num focus:outline-none focus:border-stone-900"
              />
            </div>
          </Field>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-stone-200 pt-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-stone-500">Total</div>
          <div className="font-mono text-2xl num">{fmtUSD(total)}</div>
        </div>
        <button
          onClick={submit}
          disabled={!total}
          className="bg-stone-900 text-white px-6 h-11 rounded font-medium hover:bg-stone-800 disabled:opacity-30"
        >
          Build Claim Lines
        </button>
      </div>
    </div>
  );
}

function ModeledInput({ employer, onGenerate }) {
  const [lives, setLives] = useState(employer?.covered_lives || "");
  const [spend, setSpend] = useState(
    employer?.historical_claims_spend ||
    employer?.current_total_healthcare_spend ||
    ""
  );

  return (
    <div className="bg-white border border-stone-200 rounded-lg p-8">
      <h3 className="font-display text-2xl mb-2">Model from Profile</h3>
      <p className="text-stone-600 text-sm mb-6">
        For prospects without claims data. Generates a representative claims distribution based on national benchmarks scaled to the employer's covered lives and current spend.
      </p>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Field label="Covered Lives">
          <input
            type="number"
            value={lives}
            onChange={(e) => setLives(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 font-mono num focus:outline-none focus:border-stone-900"
          />
        </Field>
        <Field label="Historical Claims Spend" tooltip="Medical + Rx claims for the period. Not premium.">
          <input
            type="number"
            value={spend}
            onChange={(e) => setSpend(e.target.value)}
            className="w-full bg-stone-50 border border-stone-200 rounded px-3 h-11 font-mono num focus:outline-none focus:border-stone-900"
          />
        </Field>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded p-4 mb-6 text-sm flex gap-2">
        <AlertCircle size={14} className="text-amber-700 shrink-0 mt-0.5" />
        <div>
          <span className="font-medium text-amber-900">Modeled output. </span>
          <span className="text-amber-800">
            For directional employer conversations. Replace with actual claims data before underwriting.
          </span>
        </div>
      </div>

      <button
        onClick={() => onGenerate(Number(lives), Number(spend))}
        disabled={!lives || !spend}
        className="bg-stone-900 text-white px-6 h-11 rounded font-medium hover:bg-stone-800 disabled:opacity-30"
      >
        Generate Modeled Dataset
      </button>
    </div>
  );
}
