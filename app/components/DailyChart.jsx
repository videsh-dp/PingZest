/**
 * Daily bar chart (single series, one axis) with a hover tooltip and a table view.
 * Plain SVG: no chart library. Bars are thin with 4px rounded tops and a 2px gap.
 */
import { useState } from "react";

const H = 180, PAD_L = 36, PAD_B = 22, PAD_T = 10;

function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => (s * pow * 4) >= v) * pow;
  return step * 4;
}
const shortDay = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });

/** data: [{ day: "2026-11-01", value: 12, detail: "340 views" }] */
export function DailyChart({ data, label, width = 960 }) {
  const [hover, setHover] = useState(null);
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const plotW = width - PAD_L - 8;
  const plotH = H - PAD_B - PAD_T;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(18, slot - 2));
  const y = (v) => PAD_T + plotH - (v / max) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
  const labelEvery = Math.ceil(data.length / 7);
  const h = hover !== null ? data[hover] : null;

  return (
    <div className="wa-chart">
      <div className="wa-chart__frame" onMouseLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${width} ${H}`} width="100%" role="img" aria-label={`${label} per day`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} x2={width - 8} y1={y(t)} y2={y(t)} className="wa-chart__grid" />
              <text x={PAD_L - 6} y={y(t) + 4} textAnchor="end" className="wa-chart__tick">{t}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD_L + i * slot + (slot - barW) / 2;
            const top = y(d.value);
            const hgt = Math.max(0, PAD_T + plotH - top);
            const r = Math.min(4, barW / 2, hgt);
            return (
              <g key={d.day}>
                {/* bar: rounded top, square base on the axis */}
                {hgt > 0 && (
                  <path
                    className={`wa-chart__bar ${hover === i ? "is-hover" : ""}`}
                    d={`M${x},${PAD_T + plotH} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${PAD_T + plotH} Z`}
                  />
                )}
                {/* hit target: the whole column, bigger than the bar */}
                <rect x={PAD_L + i * slot} y={PAD_T} width={slot} height={plotH} fill="transparent"
                  onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={-1} />
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="wa-chart__tick">{shortDay(d.day)}</text>
                )}
              </g>
            );
          })}
          <line x1={PAD_L} x2={width - 8} y1={PAD_T + plotH} y2={PAD_T + plotH} className="wa-chart__axis" />
        </svg>
        {h && (
          <div className="wa-chart__tip" style={{ left: `${((PAD_L + hover * slot + slot / 2) / width) * 100}%` }}>
            <strong>{shortDay(h.day)}</strong>
            <span>{h.value} {label.toLowerCase()}</span>
            {h.detail && <span className="wa-muted">{h.detail}</span>}
          </div>
        )}
      </div>
      <details className="wa-chart__table">
        <summary>Show as table</summary>
        <table className="wa-table">
          <thead><tr><th>Day</th><th className="wa-right">{label}</th><th>Details</th></tr></thead>
          <tbody>{data.filter((d) => d.value || d.detail).map((d) => (
            <tr key={d.day}><td>{shortDay(d.day)}</td><td className="wa-right">{d.value}</td><td className="wa-muted">{d.detail}</td></tr>
          ))}</tbody>
        </table>
      </details>
    </div>
  );
}
