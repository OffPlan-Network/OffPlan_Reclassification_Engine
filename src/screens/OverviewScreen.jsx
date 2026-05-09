import {
  Stethoscope, Pill, Hospital, Activity, ShieldCheck,
  ArrowRight, Layers, DollarSign, Network, FileText,
} from 'lucide-react';
import {
  OFFPLAN_MEMBERSHIP_PEPM,
  PBM_ADMIN_PEPM,
  FIRSTHEALTH_PEPM,
  MEDWATCH_PEPM,
  ACCIDENT_INDEMNITY_PEPM,
  TPA_PEPM,
  OFFPLAN_FIXED_OVERHEAD_PEPM,
  SCENARIO_PRESETS,
} from '../constants.js';
import { fmtUSD } from '../ui/formatters.js';
import { BucketBadge } from '../ui/BucketBadge.jsx';

// Static educational page. Explains the OffPlan model in plain language and
// puts each stack component side-by-side with its traditional major-medical
// counterpart. Numbers come from src/constants.js so the page stays anchored
// to the Source-of-Truth pricing doc.

export function OverviewScreen({ onStart }) {
  const expected = SCENARIO_PRESETS.expected;
  const expectedTotalPEPM =
    OFFPLAN_FIXED_OVERHEAD_PEPM + expected.stop_loss_pepm + 200; // $200 PMPM doc anchor for the claims fund

  return (
    <div className="space-y-12">
      <Hero onStart={onStart} expectedTotalPEPM={expectedTotalPEPM} />
      <CascadeSection />
      <StackSection />
      <ComparisonSection />
      <UnitEconomicsCallout />
    </div>
  );
}

function Hero({ onStart, expectedTotalPEPM }) {
  return (
    <section>
      <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-3">
        How OffPlan works
      </div>
      <h1 className="font-display text-5xl text-stone-900 leading-tight mb-6 max-w-3xl">
        A self-funded health plan rebuilt around what the money actually buys.
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-stone-700 leading-relaxed">
        <p className="md:col-span-2 text-base">
          A traditional major-medical plan is one big bundle: premium in, claims
          paid by a carrier, network access and pharmacy and utilization
          management all rolled into a single PEPM number. <strong>OffPlan
          unbundles that.</strong> It splits an employer's actual claim spend
          into five buckets based on what kind of care the dollar is buying,
          then prices each bucket through the financing mechanism that fits it
          best — direct primary care for routine visits, transparent cash-pay
          for shoppable specialty care, indemnity riders for predictable
          gap events, an aggregate claims fund for the residual, and stop-loss
          for the catastrophic tail.
        </p>
        <div className="bg-stone-900 text-stone-50 rounded-lg p-5">
          <div className="text-[10px] uppercase tracking-wider text-stone-400 mb-2">
            Expected scenario, all-in
          </div>
          <div className="font-mono num text-3xl font-semibold tabular-nums">
            {fmtUSD(expectedTotalPEPM, 0)}
            <span className="text-base font-normal text-stone-400 ml-1">PEPM</span>
          </div>
          <div className="text-xs text-stone-400 mt-2 leading-relaxed">
            Fixed overhead {fmtUSD(OFFPLAN_FIXED_OVERHEAD_PEPM, 2)} +
            stop-loss ${SCENARIO_PRESETS.expected.stop_loss_pepm} +
            $200 PMPM working anchor for the claims fund
          </div>
        </div>
      </div>

      <div className="mt-8 flex items-center gap-3 flex-wrap">
        {onStart && (
          <button
            onClick={onStart}
            className="bg-stone-900 text-white h-11 px-5 rounded font-medium hover:bg-stone-800 flex items-center gap-2"
          >
            See it on a real case
            <ArrowRight size={14} />
          </button>
        )}
        <span className="text-xs text-stone-500">
          Or continue scrolling — the rest of this page is the model on one screen.
        </span>
      </div>
    </section>
  );
}

function CascadeSection() {
  const buckets = [
    {
      bucket: 'A',
      title: 'Direct Primary Care',
      who: 'Office visits, preventive care, chronic management, labs',
      mechanism: 'Eliminated from claim spend. Absorbed by the flat DPC membership.',
      icon: Stethoscope,
      tint: 'bg-emerald-50 border-emerald-200',
    },
    {
      bucket: 'B',
      title: 'Cash-Pay Reference',
      who: 'Imaging, specialty consults, ASC procedures, planned surgery',
      mechanism: 'Repriced through transparent cash-pay networks at a fraction of allowed.',
      icon: Activity,
      tint: 'bg-blue-50 border-blue-200',
    },
    {
      bucket: 'C',
      title: 'ER + Indemnity Offset',
      who: 'Emergency room visits',
      mechanism: 'Utilization reduced via DPC navigation; indemnity rider absorbs the per-event copay-equivalent.',
      icon: Hospital,
      tint: 'bg-violet-50 border-violet-200',
    },
    {
      bucket: 'D',
      title: 'Residual Claims Fund',
      who: 'Everything that doesn\'t fit cleanly above',
      mechanism: 'Funded as a small employer-held fund, sized by the stochastic liquidity simulator.',
      icon: DollarSign,
      tint: 'bg-amber-50 border-amber-200',
    },
    {
      bucket: 'E',
      title: 'Catastrophic Stop-Loss',
      who: 'Inpatient, NICU, transplant, oncology — large per-member events',
      mechanism: 'Specific stop-loss attaches above a per-member threshold; aggregate stop-loss caps the year.',
      icon: ShieldCheck,
      tint: 'bg-rose-50 border-rose-200',
    },
  ];

  return (
    <section>
      <SectionHeader
        eyebrow="Step 1 — The cascade"
        title="Five buckets, five financing mechanisms"
        sub="Every claim line lands in exactly one bucket. The bucket determines how the dollar is paid for. The deterministic engine on this site walks the cascade in this order — bucket transform, then indemnity offset, then member-level stop-loss aggregation, then residual."
      />
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {buckets.map((b) => (
          <div key={b.bucket} className={`rounded-lg border ${b.tint} p-4 flex flex-col`}>
            <div className="flex items-center justify-between mb-3">
              <BucketBadge bucket={b.bucket} />
              <b.icon size={18} className="text-stone-600" />
            </div>
            <div className="font-medium text-stone-900 mb-1">{b.title}</div>
            <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">
              {b.who}
            </div>
            <div className="text-xs text-stone-700 leading-relaxed">{b.mechanism}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StackSection() {
  const rows = [
    {
      label: 'OffPlan DPC Membership',
      function: 'Unlimited primary care, chronic management, navigation',
      pepm: OFFPLAN_MEMBERSHIP_PEPM,
      status: 'locked',
    },
    {
      label: 'PBM Admin (transparent pass-through)',
      function: 'Pharmacy benefit administration without spread pricing',
      pepm: PBM_ADMIN_PEPM,
      status: 'working assumption',
    },
    {
      label: 'FirstHealth Network Access',
      function: 'Out-of-area fallback PPO when DPC + cash-pay can\'t serve',
      pepm: FIRSTHEALTH_PEPM,
      status: 'confirmed',
    },
    {
      label: 'MedWatch UM/CM',
      function: 'Inpatient + outpatient utilization and case management',
      pepm: MEDWATCH_PEPM,
      status: 'confirmed',
    },
    {
      label: 'Accident + Hospital Indemnity',
      function: 'Per-event riders that fund predictable gap costs (ER, admit, surgery)',
      pepm: ACCIDENT_INDEMNITY_PEPM,
      status: 'working assumption',
    },
    {
      label: 'TPA (Yuzu)',
      function: 'Claims administration for everything outside DPC',
      pepm: TPA_PEPM,
      status: 'confirmed',
    },
  ];

  const presetRows = Object.values(SCENARIO_PRESETS).map((p) => ({
    name: p.name,
    attach: p.attachment_point,
    pepm: p.stop_loss_pepm,
  }));

  return (
    <section>
      <SectionHeader
        eyebrow="Step 2 — The stack"
        title="What the employer pays each month, line by line"
        sub="The fixed overhead is the same for every employer. Stop-loss and the claims fund flex with population risk — the engine sizes both per case."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 bg-white border border-stone-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500">
              <tr>
                <th className="text-left px-4 py-3 border-b border-stone-200">Component</th>
                <th className="text-left px-4 py-3 border-b border-stone-200">Function</th>
                <th className="text-right px-4 py-3 border-b border-stone-200">PEPM</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-stone-100 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-stone-900">{r.label}</div>
                    <div className="text-[10px] uppercase tracking-wider text-stone-400 mt-0.5">{r.status}</div>
                  </td>
                  <td className="px-4 py-3 text-stone-600">{r.function}</td>
                  <td className="px-4 py-3 text-right font-mono num">{fmtUSD(r.pepm, 2)}</td>
                </tr>
              ))}
              <tr className="bg-stone-50 font-medium">
                <td className="px-4 py-3">Fixed overhead subtotal</td>
                <td className="px-4 py-3 text-stone-600">Same for every employer regardless of risk</td>
                <td className="px-4 py-3 text-right font-mono num">{fmtUSD(OFFPLAN_FIXED_OVERHEAD_PEPM, 2)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="bg-white border border-stone-200 rounded-lg p-5">
          <div className="text-[10px] uppercase tracking-wider text-stone-500 font-semibold mb-3">
            Scenario-dependent layers
          </div>
          <div className="space-y-4 text-sm">
            <div>
              <div className="font-medium text-stone-900 mb-1">Stop-Loss</div>
              <div className="text-xs text-stone-600 mb-2">
                Specific stop-loss premium per scenario preset. Attachment point is per-member.
              </div>
              <div className="space-y-1">
                {presetRows.map((p) => (
                  <div key={p.name} className="flex items-center justify-between text-xs">
                    <span className="text-stone-700">{p.name}</span>
                    <span className="font-mono num text-stone-600">
                      ${p.pepm} PEPM · attach {fmtUSD(p.attach)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-stone-100 pt-4">
              <div className="font-medium text-stone-900 mb-1">Claims Fund</div>
              <div className="text-xs text-stone-600">
                Sized by the stochastic liquidity simulator (Min Required Liquidity). Working
                anchor is $200 PMPM, validated per case in the Dashboard.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ComparisonSection() {
  const rows = [
    {
      function: 'Primary care visits',
      icon: Stethoscope,
      traditional: 'Fee-for-service. Member pays copay or deductible at point of service. Carrier reimburses provider from premium pool. Inflated by office-visit codes (99213, 99214).',
      offplan: 'DPC membership. Unlimited visits, no copay, $0 at point of service. Cost is the flat membership fee — not a per-visit rate.',
      tradPEPM: '~$60–$110 PEPM (fee-for-service portion of premium)',
      offPEPM: `${fmtUSD(OFFPLAN_MEMBERSHIP_PEPM, 0)} PEPM (locked)`,
    },
    {
      function: 'Pharmacy',
      icon: Pill,
      traditional: 'PBM with spread pricing, rebates kept by middlemen, formulary tiers. Member pays coinsurance on brand and specialty drugs. PMPY of $1,200–$1,800 typical.',
      offplan: 'Transparent pass-through PBM. Acquisition cost passed through with a flat admin fee. Specialty Rx flows through the cascade like any other claim.',
      tradPEPM: 'Bundled into premium, ~$100–$150 PEPM',
      offPEPM: `${fmtUSD(PBM_ADMIN_PEPM, 2)} PEPM admin + actual drug cost`,
    },
    {
      function: 'Specialty, imaging, surgery',
      icon: Activity,
      traditional: 'In-network PPO rate. Typically 90–110% of Medicare allowed. Member pays coinsurance on top of the deductible.',
      offplan: 'Cash-pay reference price. Typically 30–50% of allowed because the provider invoice is paid same-day at a contracted rate, not after carrier adjudication.',
      tradPEPM: 'Bundled into claims (PPO repricing)',
      offPEPM: 'Repriced via scenario.cashpay_discount_factor (40%–70%)',
    },
    {
      function: 'Emergency room',
      icon: Hospital,
      traditional: 'In-network ER rate after deductible. Member pays coinsurance. Utilization reflects walk-up demand — no triage layer between member and the ER.',
      offplan: 'Same allowed cost per visit, but DPC navigation reduces utilization 10–40% by routing to same-day primary care or urgent care first. Indemnity rider funds the residual.',
      tradPEPM: 'Bundled into claims',
      offPEPM: 'Reduced utilization + indemnity offset',
    },
    {
      function: 'Network access',
      icon: Network,
      traditional: 'Bundled into the carrier premium. Cost is opaque — there is no separate line item.',
      offplan: 'FirstHealth, broken out as its own line. Used as out-of-area fallback only — DPC + cash-pay handle most in-area care.',
      tradPEPM: 'Embedded in carrier markup',
      offPEPM: `${fmtUSD(FIRSTHEALTH_PEPM, 2)} PEPM`,
    },
    {
      function: 'Utilization & case mgmt',
      icon: ShieldCheck,
      traditional: 'Bundled into carrier admin. Often opaque — neither the employer nor the broker sees a line-item cost.',
      offplan: 'MedWatch, line-item PEPM. Employer can audit pre-cert and case management performance independently.',
      tradPEPM: 'Embedded in carrier markup',
      offPEPM: `${fmtUSD(MEDWATCH_PEPM, 2)} PEPM`,
    },
    {
      function: 'Claims administration',
      icon: FileText,
      traditional: 'Carrier (fully insured) or ASO admin fee for self-funded. Self-funded ASO typically $30–$60 PEPM.',
      offplan: 'TPA (Yuzu). Independent of the carrier — adjudicates everything outside the DPC and cash-pay paths.',
      tradPEPM: '$30–$60 PEPM (self-funded ASO)',
      offPEPM: `${fmtUSD(TPA_PEPM, 2)} PEPM`,
    },
    {
      function: 'Catastrophic protection',
      icon: ShieldCheck,
      traditional: 'Carrier risk pool (fully insured) or specific + aggregate stop-loss for self-funded. Specific stop-loss attaches at $25K–$100K per member.',
      offplan: 'Specific + aggregate stop-loss, line-item priced. Same product as self-funded — but smaller because the cascade has already removed Buckets A/B/C cost from the residual.',
      tradPEPM: '$120–$180 PEPM (self-funded specific stop-loss)',
      offPEPM: '$85–$130 PEPM by preset',
    },
    {
      function: 'Member cost-sharing',
      icon: DollarSign,
      traditional: 'Deductibles ($1,500–$6,000), copays, coinsurance. Member is the first dollar of risk on most non-preventive care.',
      offplan: 'Members pay $0 at point of service for primary care, labs, generic Rx. Indemnity riders absorb predictable gap events (ER, admit, surgery). Catastrophic events still go through stop-loss.',
      tradPEPM: 'Member-paid (not in employer PEPM)',
      offPEPM: `${fmtUSD(ACCIDENT_INDEMNITY_PEPM, 2)} PEPM (employer-funded indemnity)`,
    },
    {
      function: 'Risk financing',
      icon: Layers,
      traditional: 'Premium = expected claims + carrier margin (~12–15%) + admin overhead. Or self-funded with claims fund + stop-loss.',
      offplan: 'Residual claims fund (small — most spend exits the cascade earlier) + stop-loss + indemnity. Sized stochastically with a Monte Carlo simulator that produces Min Required Liquidity per case.',
      tradPEPM: 'Premium + carrier margin',
      offPEPM: 'Residual fund + $200 PMPM working anchor',
    },
  ];

  return (
    <section>
      <SectionHeader
        eyebrow="Step 3 — Side by side"
        title="Where the dollars go: traditional vs OffPlan"
        sub="Same care, same population, different financing. Each row is a function the plan has to perform; the columns are how each model performs it. PEPM ranges for the traditional side are industry-typical for self-funded plans and are illustrative — your broker's renewal is the anchor for a real comparison."
      />

      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="hidden md:grid grid-cols-12 bg-stone-50 text-[10px] uppercase tracking-wider text-stone-500 font-semibold border-b border-stone-200">
          <div className="col-span-3 px-4 py-3">Function</div>
          <div className="col-span-4 px-4 py-3 border-l border-stone-200">Traditional Major Medical</div>
          <div className="col-span-5 px-4 py-3 border-l border-stone-200 bg-stone-900 text-stone-50">OffPlan</div>
        </div>
        {rows.map((r) => (
          <div key={r.function} className="grid grid-cols-1 md:grid-cols-12 border-b border-stone-100 last:border-0 text-sm">
            <div className="md:col-span-3 px-4 py-4 bg-stone-50 md:bg-transparent">
              <div className="flex items-center gap-2 mb-1">
                <r.icon size={16} className="text-stone-500" />
                <div className="font-medium text-stone-900">{r.function}</div>
              </div>
            </div>
            <div className="md:col-span-4 px-4 py-4 md:border-l border-stone-100">
              <div className="text-stone-700 leading-relaxed mb-2">{r.traditional}</div>
              <div className="text-[10px] uppercase tracking-wider text-stone-500">{r.tradPEPM}</div>
            </div>
            <div className="md:col-span-5 px-4 py-4 md:border-l border-stone-100 bg-stone-50/60">
              <div className="text-stone-800 leading-relaxed mb-2">{r.offplan}</div>
              <div className="text-[10px] uppercase tracking-wider text-stone-600 font-mono num">{r.offPEPM}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function UnitEconomicsCallout() {
  return (
    <section className="bg-stone-900 text-stone-100 rounded-lg p-8 md:p-10">
      <div className="text-[10px] uppercase tracking-[0.18em] text-stone-400 font-semibold mb-3">
        Why the math works
      </div>
      <h2 className="font-display text-3xl text-stone-50 mb-4 max-w-3xl">
        OffPlan reduces what the employer is buying — not just what they're paying.
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm leading-relaxed text-stone-300">
        <div>
          <div className="text-stone-100 font-medium mb-2">Bucket A is removed, not discounted.</div>
          <p>
            Primary care under DPC is not a cheaper fee-for-service visit — it's
            no fee-for-service visit at all. The unit economics change, not just
            the unit price.
          </p>
        </div>
        <div>
          <div className="text-stone-100 font-medium mb-2">Bucket B is repriced at point-of-service.</div>
          <p>
            Cash-pay rates exist because the provider gets paid same-day at a
            contracted price, with no carrier adjudication or accounts
            receivable. The employer captures the discount the provider was
            already willing to give for cash.
          </p>
        </div>
        <div>
          <div className="text-stone-100 font-medium mb-2">Bucket E is the same product, smaller invoice.</div>
          <p>
            Specific stop-loss is the only piece that looks like a traditional
            insurance product — and because the cascade has already pulled
            routine care out, the stop-loss carrier is pricing a smaller,
            simpler risk pool.
          </p>
        </div>
      </div>
    </section>
  );
}

function SectionHeader({ eyebrow, title, sub }) {
  return (
    <div className="mb-6 max-w-3xl">
      <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-2">
        {eyebrow}
      </div>
      <h2 className="font-display text-3xl text-stone-900 mb-3">{title}</h2>
      <p className="text-sm text-stone-600 leading-relaxed">{sub}</p>
    </div>
  );
}
