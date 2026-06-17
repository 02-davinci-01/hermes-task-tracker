"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

const ACCENT = "#4a8eb5";
const ACCENT_DIM = "#2a5a7a";
const BG = "#0a0a0a";
const SURFACE = "#111111";
const SURFACE2 = "#1a1a1a";
const BORDER = "#222222";
const TEXT = "#d4d4d4";
const TEXT2 = "#666666";
const GREEN = "#4a9e6e";
const RED = "#9e4a4a";

const FONT = `'IBM Plex Mono', 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace`;

const getISOWeek = (d: Date): number => {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const w1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - w1.getTime()) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
};

const getISOYear = (d: Date): number => {
  const date = new Date(d);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  return date.getFullYear();
};

const today = (): string => new Date().toISOString().slice(0, 10);
const dayName = (d: string): string => new Date(d + "T12:00:00").toLocaleDateString("en", { weekday: "short" });
const monthName = (n: number): string => (["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][n] ?? "");

const errMsg = (e: unknown): string => e instanceof Error ? e.message : String(e);

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

interface WeeklyPlan {
  id?: number;
  year: number;
  week_number: number;
  planned_count: number;
}

interface Task {
  description: string;
}

interface DailyLog {
  id: number;
  log_date: string;
  completed_count: number;
  tasks: Task[] | null;
  notes: string | null;
}

interface WeeklyEfficiency {
  year: number;
  week_number: number;
  efficiency: number;
}

interface MonthlyEfficiency {
  year: number;
  month_num: number;
  avg_efficiency: number;
  weeks_counted: number;
}

type SupaClient = {
  get: <T>(table: string, query?: string) => Promise<T[]>;
  upsert: <T>(table: string, data: unknown) => Promise<T[]>;
  rpc: (fn: string, params?: Record<string, unknown>) => Promise<unknown>;
};

const supa = (url: string, key: string): SupaClient => {
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  return {
    get: async <T,>(table: string, query = ""): Promise<T[]> => {
      const r = await fetch(`${url}/rest/v1/${table}?${query}`, { headers: h });
      if (!r.ok) throw new Error(`GET ${table}: ${r.status}`);
      return r.json() as Promise<T[]>;
    },
    upsert: async <T,>(table: string, data: unknown): Promise<T[]> => {
      const r = await fetch(`${url}/rest/v1/${table}`, {
        method: "POST", headers: { ...h, Prefer: "return=representation,resolution=merge-duplicates" },
        body: JSON.stringify(data)
      });
      if (!r.ok) throw new Error(`UPSERT ${table}: ${r.status}`);
      return r.json() as Promise<T[]>;
    },
    rpc: async (fn: string, params: Record<string, unknown> = {}): Promise<unknown> => {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: "POST", headers: h, body: JSON.stringify(params)
      });
      if (!r.ok) throw new Error(`RPC ${fn}: ${r.status}`);
      return r.json();
    }
  };
};

// --- STYLES ---
const styles = {
  app: { background: BG, minHeight: "100vh", color: TEXT, fontFamily: FONT, fontSize: 13, lineHeight: 1.6 },
  container: { maxWidth: 720, margin: "0 auto", padding: "24px 16px" },
  header: { fontSize: 11, letterSpacing: "0.15em", textTransform: "uppercase" as const, color: TEXT2, marginBottom: 4 },
  title: { fontSize: 18, fontWeight: 600, color: TEXT, marginBottom: 24 },
  card: { background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 3, padding: 16, marginBottom: 12 },
  input: { background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 2, padding: "8px 12px", color: TEXT, fontFamily: FONT, fontSize: 13, width: "100%", outline: "none", boxSizing: "border-box" as const },
  btn: { background: ACCENT, color: "#fff", border: "none", borderRadius: 2, padding: "8px 16px", fontFamily: FONT, fontSize: 12, cursor: "pointer", fontWeight: 500 },
  btnGhost: { background: "transparent", color: TEXT2, border: `1px solid ${BORDER}`, borderRadius: 2, padding: "8px 16px", fontFamily: FONT, fontSize: 12, cursor: "pointer" },
  label: { fontSize: 11, color: TEXT2, textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 6, display: "block" },
  stat: { fontSize: 28, fontWeight: 700, color: TEXT, lineHeight: 1 },
  statLabel: { fontSize: 10, color: TEXT2, textTransform: "uppercase" as const, letterSpacing: "0.12em", marginTop: 4 },
  row: { display: "flex", gap: 12, alignItems: "center" },
  tag: { display: "inline-block", background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 2, padding: "2px 8px", fontSize: 11, color: TEXT2, marginRight: 6, marginBottom: 4 },
  divider: { borderTop: `1px solid ${BORDER}`, margin: "16px 0" },
};

// --- DASHBOARD ---
function Dashboard({ db }: { db: SupaClient }) {
  const [week, setWeek] = useState<WeeklyPlan | null>(null);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [history, setHistory] = useState<WeeklyEfficiency[]>([]);
  const [monthly, setMonthly] = useState<MonthlyEfficiency[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dash");
  const [err, setErr] = useState<string | null>(null);

  const yr = getISOYear(new Date());
  const wk = getISOWeek(new Date());

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const plans = await db.get<WeeklyPlan>("weekly_plans", `year=eq.${yr}&week_number=eq.${wk}`);
      setWeek(plans[0] || null);

      const d = new Date();
      const dayOfWeek = (d.getDay() + 6) % 7;
      const mon = new Date(d); mon.setDate(d.getDate() - dayOfWeek);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      const from = mon.toISOString().slice(0, 10);
      const to = sun.toISOString().slice(0, 10);
      const dl = await db.get<DailyLog>("daily_logs", `log_date=gte.${from}&log_date=lte.${to}&order=log_date.asc`);
      setLogs(dl);

      const we = await db.get<WeeklyEfficiency>("weekly_efficiency", "order=year.desc,week_number.desc&limit=12");
      setHistory(we.reverse());

      const me = await db.get<MonthlyEfficiency>("monthly_efficiency", `year=eq.${yr}&order=month_num.asc`);
      setMonthly(me);
    } catch (e) { setErr(errMsg(e)); }
    setLoading(false);
  }, [db, yr, wk]);

  useEffect(() => { load(); }, [load]);

  const completed = logs.reduce((s, l) => s + (l.completed_count || 0), 0);
  const planned = week?.planned_count || 0;
  const eff = planned > 0 ? Math.round((completed / planned) * 100) : null;

  if (loading) return (
    <div style={styles.app}>
      <div style={styles.container}>
        <p style={{ color: TEXT2, paddingTop: 40 }}>loading...</p>
      </div>
    </div>
  );

  return (
    <div style={styles.app}>
      <div style={styles.container}>
        {/* HEADER */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 20 }}>
          <div>
            <div style={styles.header}>EFFICIENCY TRACKER</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>W{wk} · {yr}</div>
          </div>
          <div style={styles.row}>
            <button style={styles.btnGhost} onClick={() => setView(view === "plan" ? "dash" : "plan")}>
              {view === "plan" ? "cancel" : "set plan"}
            </button>
            <button style={styles.btn} onClick={() => setView(view === "log" ? "dash" : "log")}>
              {view === "log" ? "cancel" : "log today"}
            </button>
          </div>
        </div>

        {err && <div style={{ ...styles.card, borderColor: RED, color: RED, fontSize: 12 }}>{err}</div>}

        {/* SET PLAN FORM */}
        {view === "plan" && <PlanForm db={db} yr={yr} wk={wk} current={week} onDone={() => { setView("dash"); load(); }} />}

        {/* LOG FORM */}
        {view === "log" && <LogForm db={db} existing={logs.find(l => l.log_date === today())} onDone={() => { setView("dash"); load(); }} />}

        {/* STATS ROW */}
        {view === "dash" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div style={styles.card}>
                <div style={styles.stat}>{planned || "—"}</div>
                <div style={styles.statLabel}>planned</div>
              </div>
              <div style={styles.card}>
                <div style={{ ...styles.stat, color: completed > 0 ? ACCENT : TEXT }}>{completed}</div>
                <div style={styles.statLabel}>completed</div>
              </div>
              <div style={styles.card}>
                <div style={{ ...styles.stat, color: eff === null ? TEXT2 : eff >= 80 ? GREEN : eff >= 50 ? ACCENT : RED }}>
                  {eff !== null ? `${eff}%` : "—"}
                </div>
                <div style={styles.statLabel}>efficiency</div>
              </div>
            </div>

            {/* PROGRESS BAR */}
            {planned > 0 && eff !== null && (
              <div style={{ ...styles.card, padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: TEXT2 }}>{completed} / {planned} tasks</span>
                  <span style={{ fontSize: 11, color: ACCENT }}>{eff}%</span>
                </div>
                <div style={{ background: SURFACE2, borderRadius: 2, height: 6, overflow: "hidden" }}>
                  <div style={{ background: ACCENT, height: "100%", width: `${Math.min(100, eff)}%`, borderRadius: 2, transition: "width 0.3s" }} />
                </div>
              </div>
            )}

            {!week && (
              <div style={{ ...styles.card, borderColor: ACCENT_DIM, textAlign: "center", padding: 24 }}>
                <p style={{ color: TEXT2, fontSize: 12, margin: 0 }}>no plan set for this week</p>
                <button style={{ ...styles.btn, marginTop: 12, fontSize: 11 }} onClick={() => setView("plan")}>set weekly plan</button>
              </div>
            )}

            {/* THIS WEEK'S LOGS */}
            {logs.length > 0 && (
              <div style={{ ...styles.card, marginTop: 4 }}>
                <div style={{ ...styles.label, marginBottom: 12 }}>This Week</div>
                {logs.map(l => (
                  <div key={l.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "8px 0", borderBottom: `1px solid ${BORDER}` }}>
                    <div>
                      <span style={{ color: ACCENT, fontSize: 12, marginRight: 8 }}>{dayName(l.log_date)}</span>
                      <span style={{ fontSize: 12, color: TEXT2 }}>{l.log_date}</span>
                      {l.tasks && l.tasks.length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          {l.tasks.map((t, i) => <span key={i} style={styles.tag}>{t.description}</span>)}
                        </div>
                      )}
                      {l.notes && <p style={{ fontSize: 11, color: TEXT2, margin: "4px 0 0" }}>{l.notes}</p>}
                    </div>
                    <span style={{ fontSize: 14, fontWeight: 600, color: TEXT, whiteSpace: "nowrap" }}>+{l.completed_count}</span>
                  </div>
                ))}
              </div>
            )}

            {/* WEEKLY TREND */}
            {history.length > 1 && (
              <div style={{ ...styles.card, marginTop: 4 }}>
                <div style={{ ...styles.label, marginBottom: 16 }}>Weekly Trend</div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={history} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                    <XAxis dataKey="week_number" tick={{ fill: TEXT2, fontSize: 10, fontFamily: FONT }} axisLine={{ stroke: BORDER }} tickLine={false} tickFormatter={v => `W${v}`} />
                    <YAxis domain={[0, 100]} tick={{ fill: TEXT2, fontSize: 10, fontFamily: FONT }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip contentStyle={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 3, fontFamily: FONT, fontSize: 12, color: TEXT }}
                      formatter={(v) => [`${v}%`, "efficiency"]} labelFormatter={l => `Week ${l}`} cursor={{ fill: SURFACE2 }} />
                    <Bar dataKey="efficiency" radius={[2, 2, 0, 0]} maxBarSize={32}>
                      {history.map((e, i) => (
                        <Cell key={i} fill={e.efficiency >= 80 ? GREEN : e.efficiency >= 50 ? ACCENT : RED} fillOpacity={e.year === yr && e.week_number === wk ? 1 : 0.6} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* MONTHLY SUMMARY */}
            {monthly.length > 0 && (
              <div style={{ ...styles.card, marginTop: 4 }}>
                <div style={{ ...styles.label, marginBottom: 12 }}>Monthly · {yr}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8 }}>
                  {monthly.map(m => (
                    <div key={m.month_num} style={{ background: SURFACE2, borderRadius: 2, padding: "10px 12px", textAlign: "center" }}>
                      <div style={{ fontSize: 10, color: TEXT2, marginBottom: 4 }}>{monthName(m.month_num)}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: m.avg_efficiency >= 80 ? GREEN : m.avg_efficiency >= 50 ? ACCENT : RED }}>
                        {m.avg_efficiency}%
                      </div>
                      <div style={{ fontSize: 10, color: TEXT2, marginTop: 2 }}>{m.weeks_counted}w</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* HERMES API INFO */}
            <div style={{ ...styles.card, marginTop: 4, borderColor: ACCENT_DIM }}>
              <div style={{ ...styles.label, marginBottom: 8, color: ACCENT }}>Hermes Integration</div>
              <p style={{ fontSize: 11, color: TEXT2, margin: 0, lineHeight: 1.8 }}>
                EOD nudge cron → you reply in Telegram → Hermes POSTs to:<br />
                <code style={{ color: ACCENT, fontSize: 11 }}>POST /rest/v1/daily_logs</code><br />
                Sunday synthesis cron reads <code style={{ color: ACCENT, fontSize: 11 }}>/rest/v1/weekly_efficiency</code> and sends digest.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// --- PLAN FORM ---
function PlanForm({ db, yr, wk, current, onDone }: {
  db: SupaClient;
  yr: number;
  wk: number;
  current: WeeklyPlan | null;
  onDone: () => void;
}) {
  const [count, setCount] = useState(current?.planned_count?.toString() ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!count) return;
    setSaving(true);
    try {
      await db.upsert("weekly_plans", { year: yr, week_number: wk, planned_count: parseInt(count) });
      onDone();
    } catch (e) { alert(errMsg(e)); }
    setSaving(false);
  };

  return (
    <div style={{ ...styles.card, marginBottom: 16 }}>
      <div style={{ ...styles.label, marginBottom: 12 }}>Set Plan for W{wk}</div>
      <div style={styles.row}>
        <input style={{ ...styles.input, width: 120 }} type="number" min="1" value={count}
          onChange={e => setCount(e.target.value)} placeholder="tasks" autoFocus />
        <button style={{ ...styles.btn, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>
          {current ? "update" : "save"}
        </button>
      </div>
    </div>
  );
}

// --- LOG FORM ---
function LogForm({ db, existing, onDone }: {
  db: SupaClient;
  existing?: DailyLog;
  onDone: () => void;
}) {
  const [count, setCount] = useState(existing?.completed_count?.toString() ?? "");
  const [taskText, setTaskText] = useState(existing?.tasks?.map(t => t.description).join(", ") ?? "");
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!count) return;
    setSaving(true);
    const tasks = taskText.split(",").map(s => s.trim()).filter(s => s.length > 0).map(d => ({ description: d }));
    try {
      await db.upsert("daily_logs", {
        log_date: today(),
        completed_count: parseInt(count),
        tasks: tasks.length > 0 ? tasks : [],
        notes: notes || null
      });
      onDone();
    } catch (e) { alert(errMsg(e)); }
    setSaving(false);
  };

  return (
    <div style={{ ...styles.card, marginBottom: 16 }}>
      <div style={{ ...styles.label, marginBottom: 12 }}>Log · {today()}</div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ ...styles.label, fontSize: 10 }}>Tasks Completed</label>
        <input style={{ ...styles.input, width: 120 }} type="number" min="0" value={count}
          onChange={e => setCount(e.target.value)} placeholder="count" autoFocus />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label style={{ ...styles.label, fontSize: 10 }}>What you shipped (comma separated)</label>
        <input style={styles.input} value={taskText} onChange={e => setTaskText(e.target.value)}
          placeholder="gateway config, PR reviews, terraform module" />
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ ...styles.label, fontSize: 10 }}>Notes (optional)</label>
        <input style={styles.input} value={notes} onChange={e => setNotes(e.target.value)} placeholder="blocked on X, good flow state" />
      </div>
      <button style={{ ...styles.btn, opacity: saving ? 0.6 : 1 }} onClick={save} disabled={saving}>
        {existing ? "update" : "save"}
      </button>
    </div>
  );
}

// --- APP ---
export default function App() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return (
      <div style={{ ...styles.app, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ textAlign: "center" }}>
          <div style={styles.header}>EFFICIENCY TRACKER</div>
          <p style={{ color: RED, fontSize: 12, marginTop: 12 }}>
            Missing env vars: <code style={{ color: TEXT }}>NEXT_PUBLIC_SUPABASE_URL</code> and <code style={{ color: TEXT }}>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
          </p>
        </div>
      </div>
    );
  }

  const db = supa(SUPABASE_URL, SUPABASE_ANON_KEY);
  return <Dashboard db={db} />;
}
