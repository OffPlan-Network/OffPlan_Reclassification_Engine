import { useState, useMemo } from 'react';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { fmtUSD, fmtNum, fmtPct } from '../ui/formatters.js';
import { BucketBadge } from '../ui/BucketBadge.jsx';

export function ClassifyScreen({ claims, onUpdateClaim, onBulkUpdate }) {
  const [filter, setFilter] = useState("");
  const [bucketFilter, setBucketFilter] = useState("all");

  // Roll-up by category — counts BOTH included and excluded so the user
  // sees the full picture, with excluded counts called out separately.
  const grouped = useMemo(() => {
    const groups = {};
    claims.forEach((c) => {
      const key = c.normalized_category || "Other";
      if (!groups[key]) {
        groups[key] = { category: key, bucket: c.bucket, count: 0, allowed: 0, lowConfidence: 0, excludedCount: 0, excludedAllowed: 0 };
      }
      groups[key].count++;
      groups[key].allowed += Number(c.allowed_amount) || 0;
      if (c.classification_confidence === "low") groups[key].lowConfidence++;
      if (c.excluded) {
        groups[key].excludedCount++;
        groups[key].excludedAllowed += Number(c.allowed_amount) || 0;
      }
    });
    return Object.values(groups).sort((a, b) => b.allowed - a.allowed);
  }, [claims]);

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return claims.filter((c) => {
      if (bucketFilter === "excluded") {
        if (!c.excluded) return false;
      } else if (bucketFilter !== "all") {
        if (c.bucket !== bucketFilter) return false;
      }
      if (!needle) return true;
      const searchable = [
        c.claim_id,
        c.member_id,
        c.cpt_code,
        c.place_of_service,
        c.provider_specialty,
        c.normalized_category,
        c.bucket,
        c.claim_type,
        c.allowed_amount,
      ].join(" ").toLowerCase();
      if (!searchable.includes(needle)) return false;
      return true;
    });
  }, [claims, filter, bucketFilter]);

  const lowConfidenceCount = claims.filter((c) => c.classification_confidence === "low").length;

  // Inclusion summary — used both for the headline stat and the bulk-action
  // label. We compute against the FULL claim set (not the filtered subset)
  // because savings calculations always run against the full set.
  const totals = useMemo(() => {
    const t = { included: 0, includedAllowed: 0, excluded: 0, excludedAllowed: 0 };
    claims.forEach((c) => {
      const a = Number(c.allowed_amount) || 0;
      if (c.excluded) { t.excluded++; t.excludedAllowed += a; }
      else { t.included++; t.includedAllowed += a; }
    });
    return t;
  }, [claims]);

  // Bulk-action target: the currently visible filtered subset.
  const filteredIds = useMemo(() => filtered.map((c) => c.claim_id), [filtered]);
  const filteredAllExcluded = filtered.length > 0 && filtered.every((c) => c.excluded);
  const filteredAllIncluded = filtered.length > 0 && filtered.every((c) => !c.excluded);

  const bulkExclude = () => {
    if (!filtered.length) return;
    if (!confirm(`Exclude ${filtered.length.toLocaleString()} claim${filtered.length === 1 ? "" : "s"} from the savings analysis? You can re-include later.`)) return;
    onBulkUpdate(filteredIds, { excluded: true }, `Bulk-excluded ${filtered.length} ${bucketFilter === "all" ? "filtered" : bucketFilter} claims`);
  };

  const bulkInclude = () => {
    if (!filtered.length) return;
    onBulkUpdate(filteredIds, { excluded: false }, `Bulk-included ${filtered.length} ${bucketFilter === "all" ? "filtered" : bucketFilter} claims`);
  };

  return (
    <div>
      <h1 className="font-display text-5xl text-stone-900 leading-none mb-2">Classification</h1>
      <p className="text-stone-600 mb-8 max-w-2xl">
        Each claim has been mapped to an OffPlan bucket. Review the breakdown, override low-confidence classifications, and adjust which claims feed the savings projection.
      </p>

      {/* Inclusion banner — savings baseline driver */}
      <div className="bg-white border border-stone-200 rounded-lg p-5 mb-6">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-stone-500 font-semibold mb-1">
              Included for savings analysis
            </div>
            <div className="font-display text-3xl text-stone-900 leading-none">
              {fmtUSD(totals.includedAllowed)}{" "}
              <span className="text-stone-400 text-xl">·</span>{" "}
              <span className="text-stone-700 text-2xl">{fmtNum(totals.included)} claims</span>
            </div>
            {totals.excluded > 0 && (
              <div className="text-xs text-stone-500 mt-2">
                {fmtNum(totals.excluded)} claim{totals.excluded === 1 ? "" : "s"} excluded
                {" · "}
                <span className="font-mono num">{fmtUSD(totals.excludedAllowed)}</span>
                {" "}withheld from analysis
              </div>
            )}
          </div>
          {totals.excluded > 0 && (
            <button
              onClick={() => onBulkUpdate(claims.filter((c) => c.excluded).map((c) => c.claim_id), { excluded: false }, "Re-include all excluded claims")}
              className="text-xs text-stone-700 hover:text-stone-900 underline"
            >
              Re-include all excluded
            </button>
          )}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden mb-6">
        <div className="bg-stone-50 border-b border-stone-200 px-5 py-3 flex items-center justify-between">
          <h3 className="font-medium text-stone-900">Category Breakdown</h3>
          {lowConfidenceCount > 0 && (
            <div className="text-xs text-amber-700 flex items-center gap-1">
              <AlertCircle size={12} />
              {lowConfidenceCount} claims flagged for manual review
            </div>
          )}
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-stone-200 text-[10px] uppercase tracking-wider text-stone-500">
              <th className="text-left px-5 py-3">Category</th>
              <th className="text-left px-5 py-3">Bucket</th>
              <th className="text-right px-5 py-3">Claims</th>
              <th className="text-right px-5 py-3">Allowed</th>
              <th className="text-right px-5 py-3">Excluded</th>
              <th className="text-right px-5 py-3">% of Total</th>
            </tr>
          </thead>
          <tbody>
            {grouped.map((g) => {
              const totalAllowed = grouped.reduce((s, x) => s + x.allowed, 0);
              return (
                <tr key={g.category} className="border-b border-stone-100">
                  <td className="px-5 py-3">
                    <div className="font-medium text-stone-900">{g.category}</div>
                    {g.lowConfidence > 0 && (
                      <div className="text-xs text-amber-700">{g.lowConfidence} flagged</div>
                    )}
                  </td>
                  <td className="px-5 py-3"><BucketBadge bucket={g.bucket} /></td>
                  <td className="px-5 py-3 text-right font-mono num">{fmtNum(g.count)}</td>
                  <td className="px-5 py-3 text-right font-mono num">{fmtUSD(g.allowed)}</td>
                  <td className="px-5 py-3 text-right">
                    {g.excludedCount > 0 ? (
                      <div className="text-xs text-stone-500">
                        <div className="font-mono num">{fmtNum(g.excludedCount)}</div>
                        <div className="font-mono num">{fmtUSD(g.excludedAllowed)}</div>
                      </div>
                    ) : (
                      <span className="text-stone-300">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-mono num text-stone-500">{fmtPct(g.allowed / totalAllowed)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Filter bar with bulk actions */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search claims by CPT, member, category..."
          className="flex-1 min-w-[240px] bg-white border border-stone-200 rounded px-3 h-9 text-sm focus:outline-none focus:border-stone-900"
        />
        <div className="flex border border-stone-200 rounded overflow-hidden">
          {["all", "A", "B", "C", "D", "E", "excluded"].map((b) => (
            <button
              key={b}
              onClick={() => setBucketFilter(b)}
              className={`px-3 h-9 text-xs font-medium ${
                bucketFilter === b ? "bg-stone-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"
              }`}
            >
              {b === "all" ? "All" : b === "excluded" ? "Excluded" : `Bucket ${b}`}
            </button>
          ))}
        </div>
        {filtered.length > 0 && (
          <div className="flex items-center gap-2">
            {!filteredAllExcluded && (
              <button
                onClick={bulkExclude}
                className="flex items-center gap-1.5 border border-stone-300 text-stone-700 hover:bg-stone-50 px-3 h-9 text-xs font-medium rounded"
                title={`Exclude all ${filtered.length} matching claims`}
              >
                <EyeOff size={12} />
                Exclude {fmtNum(filtered.length)}
              </button>
            )}
            {!filteredAllIncluded && (
              <button
                onClick={bulkInclude}
                className="flex items-center gap-1.5 border border-stone-300 text-stone-700 hover:bg-stone-50 px-3 h-9 text-xs font-medium rounded"
                title={`Include all ${filtered.length} matching claims`}
              >
                <Eye size={12} />
                Include {fmtNum(filtered.length)}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Detail table */}
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-[10px] uppercase tracking-wider text-stone-500 bg-stone-50">
                <th className="px-3 py-2 w-10"></th>
                <th className="text-left px-4 py-2">Claim</th>
                <th className="text-left px-4 py-2">Member</th>
                <th className="text-left px-4 py-2">CPT</th>
                <th className="text-left px-4 py-2">POS</th>
                <th className="text-left px-4 py-2">Category</th>
                <th className="text-left px-4 py-2">Bucket</th>
                <th className="text-right px-4 py-2">Allowed</th>
                <th className="text-left px-4 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 100).map((c) => (
                <ClaimRow key={c.claim_id} claim={c} onUpdate={onUpdateClaim} />
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 100 && (
          <div className="px-5 py-3 text-xs text-stone-500 border-t border-stone-200 bg-stone-50">
            Showing 100 of {fmtNum(filtered.length)} claims. Use search and filters to narrow.
          </div>
        )}
      </div>
    </div>
  );
}

function ClaimRow({ claim, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const flagged = claim.classification_confidence === "low";
  const excluded = !!claim.excluded;
  return (
    <tr className={`border-b border-stone-100 ${
      excluded ? "bg-stone-50/80 text-stone-400" : flagged ? "bg-amber-50/40" : ""
    } hover:bg-stone-50`}>
      <td className="px-3 py-2 text-center">
        <input
          type="checkbox"
          checked={!excluded}
          onChange={(e) => onUpdate(
            claim.claim_id,
            { excluded: !e.target.checked },
            e.target.checked ? "Re-included by user" : "Excluded by user",
            "exclude",
          )}
          title={excluded ? "Click to include in analysis" : "Click to exclude from analysis"}
          className="cursor-pointer"
        />
      </td>
      <td className={`px-4 py-2 font-mono text-xs ${excluded ? "line-through" : ""}`}>{claim.claim_id}</td>
      <td className="px-4 py-2 font-mono text-xs">{claim.member_id}</td>
      <td className="px-4 py-2 font-mono text-xs">{claim.cpt_code || "—"}</td>
      <td className="px-4 py-2 text-xs">{claim.place_of_service || "—"}</td>
      <td className="px-4 py-2">{claim.normalized_category}</td>
      <td className="px-4 py-2">
        {editing ? (
          <select
            value={claim.bucket}
            onChange={(e) => { onUpdate(claim.claim_id, { bucket: e.target.value }); setEditing(false); }}
            onBlur={() => setEditing(false)}
            autoFocus
            className="text-xs border border-stone-300 rounded px-1 h-6"
          >
            {["A", "B", "C", "D", "E"].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        ) : (
          <button onClick={() => setEditing(true)} disabled={excluded}>
            <BucketBadge bucket={claim.bucket} small />
          </button>
        )}
        {claim.manual_override && <span className="ml-1 text-[10px] text-stone-500">(override)</span>}
      </td>
      <td className={`px-4 py-2 text-right font-mono num ${excluded ? "line-through" : ""}`}>{fmtUSD(claim.allowed_amount, 0)}</td>
      <td className="px-4 py-2 text-xs text-stone-500">
        {excluded ? <span className="text-rose-600 font-medium">Excluded</span> : claim.classification_source}
      </td>
    </tr>
  );
}
