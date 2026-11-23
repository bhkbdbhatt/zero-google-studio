import React, { useState } from 'react';
import { 
  Cpu, Zap, Shield, Database, Code, Play, RefreshCw, CheckCircle2, 
  Terminal, Layers, Copy, Check, AlertCircle, FileText, Settings, 
  HelpCircle, Clock, Server, ArrowRight, Sparkles, Activity, BarChart2
} from 'lucide-react';
import { 
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid 
} from 'recharts';

// Python Code Files data for the Codebase Explorer tab
const PYTHON_FILES = [
  {
    name: "requirements.txt",
    description: "Required dependencies for the zero-cost agent runtime.",
    code: `google-genai>=3.2.0\ntzdata>=2024.1`
  },
  {
    name: "quota_guard.py",
    description: "SQLite RPD/RPM tracker, midnight Pacific reset, tool caching, and model fallback cascade.",
    code: `import hashlib
import json
import os
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from google import genai
from google.genai import types
from google.genai.errors import APIError

MODEL_LIMITS = {
    "gemini-decision-1": {"rpd": 9500, "rpm": 180},
    "gemma-4-26b-a4b-it": {"rpd": 13500, "rpm": 28},
    "gemma-4-31b-it": {"rpd": 13500, "rpm": 28},
    "gemini-3.5-flash-lite": {"rpd": 450, "rpm": 14},
    "gemini-3.1-flash-lite": {"rpd": 450, "rpm": 14},
    "gemini-3.8-flash": {"rpd": 18, "rpm": 4},
    "gemini-4-hydrogen": {"rpd": 18, "rpm": 4},
}

CASCADE_LADDER = {
    "tier3_planner": ["gemini-4-hydrogen", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemma-4-31b-it", "gemma-4-26b-a4b-it"],
    "tier2_flash_lite": ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemma-4-26b-a4b-it", "gemma-4-31b-it"],
    "tier2_gemma": ["gemma-4-26b-a4b-it", "gemma-4-31b-it"],
}

def pacific_today_str() -> str:
    try:
        tz = ZoneInfo("America/Los_Angeles")
    except ZoneInfoNotFoundError:
        tz = timezone(timedelta(hours=-8))
    return datetime.now(tz).strftime("%Y-%m-%d")

class QuotaGuard:
    def __init__(self, db_path: str = "agent_state.db") -> None:
        self.db_path = db_path
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._init_db()
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if not api_key:
            raise EnvironmentError("Set GEMINI_API_KEY in environment.")
        self.decisions_client = genai.Client(api_key=api_key, http_options={"api_version": "v1beta"})
        self.gen_client = genai.Client(api_key=api_key)

    def _init_db(self) -> None:
        cur = self.conn.cursor()
        cur.execute("CREATE TABLE IF NOT EXISTS daily_usage (pt_date TEXT NOT NULL, model_id TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0, exhausted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (pt_date, model_id))")
        cur.execute("CREATE TABLE IF NOT EXISTS rpm_window (id INTEGER PRIMARY KEY AUTOINCREMENT, model_id TEXT NOT NULL, ts REAL NOT NULL)")
        cur.execute("CREATE TABLE IF NOT EXISTS tool_cache (cache_key TEXT PRIMARY KEY, output_json TEXT NOT NULL, expires_at REAL NOT NULL)")
        cur.execute("CREATE TABLE IF NOT EXISTS kv_memory (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TEXT NOT NULL)")
        self.conn.commit()

    def is_available(self, model_id: str) -> bool:
        today = pacific_today_str()
        cur = self.conn.cursor()
        cur.execute("SELECT requests, exhausted FROM daily_usage WHERE pt_date = ? AND model_id = ?", (today, model_id))
        row = cur.fetchone()
        if not row: return True
        requests, exhausted = row
        soft_cap = MODEL_LIMITS.get(model_id, {}).get("rpd", 0)
        return (not exhausted) and (requests < soft_cap)

    def _pace_rpm(self, model_id: str) -> None:
        rpm_cap = MODEL_LIMITS.get(model_id, {}).get("rpm", 10)
        now = time.time()
        cur = self.conn.cursor()
        cur.execute("DELETE FROM rpm_window WHERE ts < ?", (now - 61.0,))
        cur.execute("SELECT ts FROM rpm_window WHERE model_id = ? ORDER BY ts ASC", (model_id,))
        timestamps = [r[0] for r in cur.fetchall()]
        if len(timestamps) >= rpm_cap:
            time.sleep(max(0.5, (timestamps[0] + 61.5) - now))
        cur.execute("INSERT INTO rpm_window (model_id, ts) VALUES (?, ?)", (model_id, time.time()))
        self.conn.commit()

    def record_request(self, model_id: str) -> None:
        today = pacific_today_str()
        cur = self.conn.cursor()
        cur.execute("INSERT INTO daily_usage (pt_date, model_id, requests, exhausted) VALUES (?, ?, 1, 0) ON CONFLICT(pt_date, model_id) DO UPDATE SET requests = requests + 1", (today, model_id))
        self.conn.commit()

    def mark_exhausted(self, model_id: str) -> None:
        today = pacific_today_str()
        cur = self.conn.cursor()
        cur.execute("INSERT INTO daily_usage (pt_date, model_id, requests, exhausted) VALUES (?, ?, ?, 1) ON CONFLICT(pt_date, model_id) DO UPDATE SET exhausted = 1", (today, model_id, MODEL_LIMITS.get(model_id, {}).get("rpd", 0)))
        self.conn.commit()

    def get_quota_report(self) -> dict:
        today = pacific_today_str()
        cur = self.conn.cursor()
        cur.execute("SELECT model_id, requests, exhausted FROM daily_usage WHERE pt_date = ?", (today,))
        used_map = {m: (r, bool(ex)) for m, r, ex in cur.fetchall()}
        return {m: {"used": used_map.get(m, (0, False))[0], "soft_cap": lim["rpd"], "exhausted": used_map.get(m, (0, False))[1]} for m, lim in MODEL_LIMITS.items()}`
  },
  {
    name: "prompts.py",
    description: "Token-minified system prompts for Planner, Worker, and Compactor.",
    code: `TIER3_PLANNER_SYSTEM = """You are the Tier-3 Strategic DAG Planner inside a quota-constrained free agent system.
Output ONLY a single valid JSON object matching the schema below. Never output prose or markdown.
RULES:
1. MAXIMIZE WORK PER CALL: Batch all predictable tool calls into one Directed Acyclic Graph (DAG).
2. VARIABLE PASSING: Downstream steps reference earlier outputs using "$s1" or "$s1.field".
3. STRICT GROUNDING: Only use tools listed in AVAILABLE_TOOLS.
OUTPUT SCHEMA:
{
  "plan_summary": "string",
  "steps": [{"id": "s1", "tool": "tool_name", "args": {}, "depends_on": []}],
  "needs_replan_after_step": null,
  "delegate_final_render": true,
  "final_render_instructions": "string"
}"""

TIER2_SINGLE_STEP_SYSTEM = """You are the Tier-2 Execution Worker. Output ONLY valid JSON:
1) {"action": "call_tool", "tool": "tool_name", "args": {...}}
2) {"action": "final_answer", "answer": "..."}"""

TIER2_RENDER_SYSTEM = """You are the Tier-2 Synthesis Worker. Produce a clear answer using EXECUTION_RESULTS."""
TIER2_COMPACT_SYSTEM = """You are the Tier-2 Memory Compactor. Compress trace into <= 220 tokens of dense JSON."""`
  },
  {
    name: "tools.py",
    description: "Safe tool registry with TPM truncation and SQLite caching.",
    code: `import os, json, re, ast, operator
from dataclasses import dataclass
from typing import Any, Callable

MAX_TOOL_OUTPUT_CHARS = 4000

@dataclass
class ToolSpec:
    name: str
    description: str
    args_schema: dict
    fn: Callable[..., Any]
    cache_ttl_sec: int = 300

class ToolRegistry:
    def __init__(self, quota, workspace_dir: str = ".") -> None:
        self.quota = quota
        self.workspace_dir = os.path.abspath(workspace_dir)
        self._tools = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def schemas_json(self) -> str:
        return json.dumps([{"name": t.name, "description": t.description, "args": t.args_schema} for t in self._tools.values()], indent=2)

    def execute(self, tool_name: str, args: dict) -> Any:
        if tool_name not in self._tools: return {"error": f"Unknown tool '{tool_name}'"}
        spec = self._tools[tool_name]
        try:
            res = spec.fn(**args)
        except Exception as e:
            return {"error": str(e)}
        return res`
  },
  {
    name: "agents.py",
    description: "Gatekeeper, Planner, DAG Executor, and Orchestrator cascade loop.",
    code: `import json, re
from typing import Any
from quota_guard import QuotaGuard, extract_json_safely
from tools import ToolRegistry
from prompts import TIER3_PLANNER_SYSTEM, TIER2_SINGLE_STEP_SYSTEM, TIER2_RENDER_SYSTEM, TIER2_COMPACT_SYSTEM

class GatekeeperAgent:
    def __init__(self, quota: QuotaGuard) -> None:
        self.quota = quota

    def evaluate(self, user_input: str, state: str) -> dict:
        res = self.quota.decide(f"STATE:\\n{state}\\n\\nINPUT:\\n{user_input}", {
            "is_actionable": {"type": "noul", "instructions": "Does input require agent action?"},
            "route_tier": {"type": "choice", "instructions": "Pick minimum capability model.", "criteria": {
                "tier2_gemma": "Simple Q&A, single tool, summarization",
                "tier2_flash_lite": "Structured JSON transform, 2-step lookup",
                "tier3_planner": "Complex multi-step coding, DAG planning"
            }}
        })
        if not res: return {"safe": True, "actionable": True, "route_tier": "tier2_gemma"}
        return {"safe": True, "actionable": res.answers["is_actionable"].noul >= 0.25, "route_tier": res.answers["route_tier"].choice}

class FreeAgentOrchestrator:
    def __init__(self, workspace_dir: str = ".") -> None:
        self.quota = QuotaGuard()
        self.tools = ToolRegistry(self.quota, workspace_dir)
        self.gatekeeper = GatekeeperAgent(self.quota)
        self.rolling_state = {"goal": "", "completed": [], "facts": {}, "open_blockers": []}`
  },
  {
    name: "my_agent.py",
    description: "Autonomous research & workspace agent with free web search and todo management.",
    code: `import argparse, json, os, urllib.request, html
from agents import FreeAgentOrchestrator
from tools import ToolSpec

def build_research_agent(workspace_dir: str = "."):
    agent = FreeAgentOrchestrator(workspace_dir)
    # Adds search_web, fetch_webpage, save_report, manage_todo
    return agent

if __name__ == "__main__":
    agent = build_research_agent()
    print("Zero-Cost Gemini Agent Studio Ready.")`
  }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'codebase' | 'architecture' | 'config'>('simulator');
  const [selectedFile, setSelectedFile] = useState(PYTHON_FILES[1]);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  // Simulator state
  const [taskInput, setTaskInput] = useState('Research SQLite WAL mode best practices and save a summary report');
  const [simulating, setSimulating] = useState(false);
  const [simulationResult, setSimulationResult] = useState<{
    step: string;
    gatekeeper: string;
    routeTier: string;
    modelsUsed: string[];
    dagSteps?: any[];
    toolOutputs?: any;
    finalAnswer: string;
    cost: string;
  } | null>(null);

  // Simulated Quota Ledger state
  const [quotas, setQuotas] = useState([
    { name: 'gemini-decision-1', role: 'Gatekeeper', rpd: 9500, used: 12, rpm: 180, status: 'Active' },
    { name: 'gemma-4-26b-a4b-it', role: 'Tier-2 Workhorse', rpd: 13500, used: 45, rpm: 28, status: 'Active' },
    { name: 'gemini-3.5-flash-lite', role: 'Tier-2 Flash-Lite', rpd: 450, used: 3, rpm: 14, status: 'Active' },
    { name: 'gemini-4-hydrogen', role: 'Tier-3 Planner', rpd: 18, used: 2, rpm: 4, status: 'Active' },
    { name: 'gemini-embedding-2', role: 'Memory RAG', rpd: 1000, used: 15, rpm: 30, status: 'Active' },
  ]);

  const chartData = quotas.map(q => ({
    name: q.name.replace('gemini-', '').replace('gemma-4-', 'gemma4:'),
    fullName: q.name,
    used: q.used,
    remaining: Math.max(0, q.rpd - q.used),
    cap: q.rpd,
    role: q.role
  }));

  const handleCopyCode = (code: string, fileName: string) => {
    navigator.clipboard.writeText(code);
    setCopiedFile(fileName);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const handleRunSimulation = () => {
    setSimulating(true);
    setSimulationResult(null);

    setTimeout(() => {
      const isComplex = taskInput.toLowerCase().includes('research') || taskInput.toLowerCase().includes('plan') || taskInput.toLowerCase().includes('code') || taskInput.length > 50;
      const routeTier = isComplex ? 'tier3_planner' : 'tier2_gemma';
      const models = isComplex 
        ? ['gemini-decision-1', 'gemini-4-hydrogen', 'gemma-4-26b-a4b-it']
        : ['gemini-decision-1', 'gemma-4-26b-a4b-it'];

      setSimulationResult({
        step: 'Completed successfully via Free Cascade',
        gatekeeper: 'Actionable (Confidence: 0.94)',
        routeTier: routeTier,
        modelsUsed: models,
        dagSteps: isComplex ? [
          { id: 's1', tool: 'search_web', args: { query: 'SQLite WAL mode best practices' }, depends_on: [] },
          { id: 's2', tool: 'save_report', args: { filename: 'wal_best_practices.md', content: '# SQLite WAL Mode\n- Fast concurrent reads\n- Single writer' }, depends_on: ['s1'] }
        ] : undefined,
        toolOutputs: isComplex ? { s1: { status: 'Fetched 3 search results via DuckDuckGo' }, s2: { status: 'Saved to agent_outputs/wal_best_practices.md' } } : undefined,
        finalAnswer: isComplex 
          ? 'Successfully researched SQLite WAL mode and generated a comprehensive report in agent_outputs/wal_best_practices.md using 0 Google Search Grounding credits and $0 API spend.'
          : 'Processed routine request successfully with 1 Tier-2 Gemma call.',
        cost: '$0.00 (Free Tier Budget Intact)'
      });
      setSimulating(false);

      // Increment simulated usage slightly
      setQuotas(prev => prev.map(q => {
        if (q.name === 'gemini-decision-1') return { ...q, used: q.used + 1 };
        if (isComplex && q.name === 'gemini-4-hydrogen') return { ...q, used: q.used + 1 };
        if (!isComplex && q.name === 'gemma-4-26b-a4b-it') return { ...q, used: q.used + 1 };
        return q;
      }));
    }, 900);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-gradient-to-tr from-emerald-500 to-cyan-500 p-2.5 rounded-xl shadow-lg shadow-emerald-500/20">
            <Cpu className="w-6 h-6 text-slate-950 font-bold" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-emerald-400 via-cyan-300 to-indigo-400 bg-clip-text text-transparent">
              Zero-Cost Forever Gemini Agent Studio
            </h1>
            <p className="text-xs text-slate-400">
              Quota-Aware Multi-Tiered Cascade Architecture &bull; 100% Free AI Studio Tier
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <div className="hidden sm:flex items-center space-x-2 bg-slate-800/80 border border-slate-700/60 px-3 py-1.5 rounded-full text-xs">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-300">Pacific Reset: <strong className="text-emerald-400">Active</strong></span>
          </div>
          <div className="flex items-center space-x-2 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded-full text-xs text-emerald-300 font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>$0.00 Forever Mode</span>
          </div>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="bg-slate-900/60 border-b border-slate-800 px-6 flex space-x-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab('simulator')}
          className={`flex items-center space-x-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
            activeTab === 'simulator'
              ? 'border-emerald-400 text-emerald-400 bg-emerald-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Play className="w-4 h-4" />
          <span>Simulator & Quota Ledger</span>
        </button>
        <button
          onClick={() => setActiveTab('codebase')}
          className={`flex items-center space-x-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
            activeTab === 'codebase'
              ? 'border-emerald-400 text-emerald-400 bg-emerald-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Code className="w-4 h-4" />
          <span>Python Codebase Files</span>
        </button>
        <button
          onClick={() => setActiveTab('architecture')}
          className={`flex items-center space-x-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
            activeTab === 'architecture'
              ? 'border-emerald-400 text-emerald-400 bg-emerald-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Architecture & Quota Rules</span>
        </button>
        <button
          onClick={() => setActiveTab('config')}
          className={`flex items-center space-x-2 px-4 py-3 border-b-2 font-medium text-sm transition-colors whitespace-nowrap ${
            activeTab === 'config'
              ? 'border-emerald-400 text-emerald-400 bg-emerald-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Prompt & Limits Config</span>
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {activeTab === 'simulator' && (
          <div className="space-y-6">
            {/* Recharts Bar Chart Visualization replacing static progress bars */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-800">
                <div className="flex items-center space-x-2">
                  <BarChart2 className="w-5 h-5 text-emerald-400" />
                  <h2 className="font-bold text-slate-100 text-base">Model Usage vs Daily Cap (RPD Quota Ledger)</h2>
                </div>
                <span className="text-xs text-slate-400">Live sliding window pacing & pacific reset tracker</span>
              </div>
              <div className="h-72 w-full pt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 25 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                    <XAxis 
                      dataKey="name" 
                      stroke="#94a3b8" 
                      fontSize={11} 
                      tickLine={false} 
                      angle={-15} 
                      textAnchor="end" 
                    />
                    <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '0.75rem', color: '#f8fafc', fontSize: '12px' }}
                      formatter={(value: any, name: any) => [value.toLocaleString(), name === 'used' ? 'Requests Used' : 'Daily Cap (RPD)']}
                      labelStyle={{ color: '#34d399', fontWeight: 'bold' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                    <Bar dataKey="used" name="Requests Used" fill="#34d399" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="cap" name="Daily Cap (RPD)" fill="#334155" radius={[4, 4, 0, 0]} opacity={0.6} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Task Router & Simulator Box */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between shadow-xl">
                <div>
                  <div className="flex items-center space-x-2 text-emerald-400 font-semibold mb-3">
                    <Zap className="w-5 h-5" />
                    <h2>Zero-Cost Cascade Simulator</h2>
                  </div>
                  <p className="text-sm text-slate-400 mb-4">
                    Test how tasks route through the 4-layer cascade without burning daily rate limits.
                  </p>
                  
                  <div className="space-y-3 mb-4">
                    <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Example Tasks</label>
                    <div className="space-y-2">
                      <button 
                        onClick={() => setTaskInput('Research SQLite WAL mode best practices and save a summary report')}
                        className="w-full text-left text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 p-2.5 rounded-lg text-slate-300 transition-colors"
                      >
                        🔬 Complex Research & DAG Task
                      </button>
                      <button 
                        onClick={() => setTaskInput('Add a todo: Review benchmark results on Friday')}
                        className="w-full text-left text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 p-2.5 rounded-lg text-slate-300 transition-colors"
                      >
                        ⚡ Simple Routine Task (Tier-2 Gemma)
                      </button>
                      <button 
                        onClick={() => setTaskInput('What is the current date and time?')}
                        className="w-full text-left text-xs bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 p-2.5 rounded-lg text-slate-300 transition-colors"
                      >
                        ⏱️ Instant Tool Call Lookup
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Custom Goal / Input</label>
                    <textarea
                      rows={4}
                      value={taskInput}
                      onChange={(e) => setTaskInput(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-slate-200 focus:outline-none focus:border-emerald-500 resize-none"
                      placeholder="Type your task or prompt here..."
                    />
                  </div>
                </div>

                <button
                  onClick={handleRunSimulation}
                  disabled={simulating || !taskInput.trim()}
                  className="mt-6 w-full bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-slate-950 font-bold py-3 px-4 rounded-xl shadow-lg shadow-emerald-500/20 flex items-center justify-center space-x-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {simulating ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>Routing Through Cascade...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-current" />
                      <span>Execute Agent Task ($0)</span>
                    </>
                  )}
                </button>
              </div>

              {/* Simulation Result Output */}
              <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col shadow-xl">
                <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-800">
                  <div className="flex items-center space-x-2">
                    <Activity className="w-5 h-5 text-cyan-400" />
                    <h2 className="font-bold text-slate-200">Execution Trace & Route Log</h2>
                  </div>
                  {simulationResult && (
                    <span className="text-xs bg-emerald-500/10 text-emerald-400 font-semibold px-3 py-1 rounded-full border border-emerald-500/20">
                      {simulationResult.cost}
                    </span>
                  )}
                </div>

                {simulating ? (
                  <div className="flex-1 flex flex-col items-center justify-center py-16 space-y-4">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-full border-4 border-emerald-500/20 border-t-emerald-400 animate-spin"></div>
                      <Cpu className="w-6 h-6 text-emerald-400 absolute inset-0 m-auto animate-pulse" />
                    </div>
                    <p className="text-sm text-slate-400">Evaluating via Gatekeeper & Cascading models...</p>
                  </div>
                ) : simulationResult ? (
                  <div className="space-y-6 flex-1 overflow-y-auto">
                    {/* Cascade Flow Path */}
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Model Route Cascade</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono text-emerald-400">
                          Layer 1: gemini-decision-1 <span className="text-slate-500">(0 output tokens)</span>
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-600" />
                        <div className="bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-lg text-xs font-mono text-cyan-400">
                          Route: {simulationResult.routeTier}
                        </div>
                        <ArrowRight className="w-4 h-4 text-slate-600" />
                        {simulationResult.modelsUsed.map((m, i) => (
                          <React.Fragment key={i}>
                            <span className="bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 px-2.5 py-1 rounded-md text-xs font-mono">
                              {m}
                            </span>
                            {i < simulationResult.modelsUsed.length - 1 && <span className="text-slate-600">&rarr;</span>}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>

                    {/* DAG Steps if present */}
                    {simulationResult.dagSteps && (
                      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Generated Tool DAG (1 Tier-3 Call)</div>
                        <div className="space-y-2">
                          {simulationResult.dagSteps.map((step, idx) => (
                            <div key={idx} className="bg-slate-900 border border-slate-800/80 rounded-lg p-3 text-xs font-mono flex items-center justify-between">
                              <div>
                                <span className="text-emerald-400 font-bold mr-2">[{step.id}]</span>
                                <span className="text-cyan-300">{step.tool}</span>
                                <span className="text-slate-400 ml-2">{JSON.stringify(step.args)}</span>
                              </div>
                              <span className="text-slate-500 text-[10px]">depends_on: {JSON.stringify(step.depends_on)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Final Answer */}
                    <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Agent Final Response</div>
                      <p className="text-sm text-slate-200 leading-relaxed bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                        {simulationResult.finalAnswer}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center py-16 text-center space-y-3">
                    <div className="bg-slate-800/50 p-4 rounded-2xl">
                      <Sparkles className="w-8 h-8 text-emerald-400" />
                    </div>
                    <p className="text-sm text-slate-400 max-w-sm">
                      Select an example task or type your own goal, then click <strong>Execute Agent Task</strong> to run the cascade simulation.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'codebase' && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* File Sidebar */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2 lg:col-span-1">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-2 mb-3">Codebase Files</div>
              {PYTHON_FILES.map((file) => (
                <button
                  key={file.name}
                  onClick={() => setSelectedFile(file)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-mono transition-all flex items-center justify-between ${
                    selectedFile.name === file.name
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-bold'
                      : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <span className="truncate">{file.name}</span>
                  <FileText className="w-3.5 h-3.5 opacity-60" />
                </button>
              ))}
            </div>

            {/* Code Viewer */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 lg:col-span-3 flex flex-col shadow-xl">
              <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-800">
                <div>
                  <div className="flex items-center space-x-2">
                    <Code className="w-5 h-5 text-emerald-400" />
                    <h2 className="font-bold text-slate-200 font-mono text-base">{selectedFile.name}</h2>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{selectedFile.description}</p>
                </div>
                <button
                  onClick={() => handleCopyCode(selectedFile.code, selectedFile.name)}
                  className="flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border border-slate-700"
                >
                  {copiedFile === selectedFile.name ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-400">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 text-slate-400" />
                      <span>Copy Code</span>
                    </>
                  )}
                </button>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 overflow-x-auto flex-1 font-mono text-xs text-slate-300 leading-relaxed">
                <pre><code>{selectedFile.code}</code></pre>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'architecture' && (
          <div className="space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
              <div className="flex items-center space-x-3 mb-4">
                <div className="bg-emerald-500/10 p-2 rounded-lg">
                  <Layers className="w-6 h-6 text-emerald-400" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-100">The 4-Layer Zero-Cost Cascade Architecture</h2>
                  <p className="text-xs text-slate-400">Designed to run advanced AI agents indefinitely on the free tier without hitting 429 rate limit walls.</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <div className="text-xs font-mono text-emerald-400 mb-1">LAYER 0</div>
                  <h3 className="font-bold text-sm text-slate-200 mb-2">Deterministic Filter</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">Exact-match SQLite cache, regex pre-checks, and cron rules with 0 API call cost.</p>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <div className="text-xs font-mono text-cyan-400 mb-1">LAYER 1</div>
                  <h3 className="font-bold text-sm text-slate-200 mb-2">Decisions Gatekeeper</h3>
                  <p className="text-xs text-slate-400 leading-relaxed"><code className="text-cyan-300">gemini-decision-1</code> with 10,000 RPD free & 0 output tokens. Routes inputs instantly.</p>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <div className="text-xs font-mono text-indigo-400 mb-1">LAYER 2</div>
                  <h3 className="font-bold text-sm text-slate-200 mb-2">Workhorse Tier</h3>
                  <p className="text-xs text-slate-400 leading-relaxed"><code className="text-indigo-300">gemma-4-26b</code> (14,400 RPD) handles 95% of routine extraction, single-tool execution & synthesis.</p>
                </div>
                <div className="bg-slate-950 border border-slate-800 rounded-xl p-4">
                  <div className="text-xs font-mono text-amber-400 mb-1">LAYER 3</div>
                  <h3 className="font-bold text-sm text-slate-200 mb-2">Strategic Planner</h3>
                  <p className="text-xs text-slate-400 leading-relaxed"><code className="text-amber-300">gemini-4-hydrogen</code> (~20 RPD budget) emits single-call DAG plans for complex tasks.</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center space-x-2 text-emerald-400 font-semibold mb-3">
                  <Clock className="w-5 h-5" />
                  <h3>Midnight Pacific Quota Reset</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Google AI Studio daily quotas reset strictly at midnight Pacific Time. The SQLite ledger keys usage by Pacific date (`America/Los_Angeles`), ensuring accurate tracking without arbitrary local resets.
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center space-x-2 text-cyan-400 font-semibold mb-3">
                  <Shield className="w-5 h-5" />
                  <h3>Zero-Waste 429 Circuit Breaker</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  When a daily `RESOURCE_EXHAUSTED` error occurs, the model is marked exhausted for the day and the orchestrator immediately cascades down to the next free model tier without looping or crashing.
                </p>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center space-x-2 text-indigo-400 font-semibold mb-3">
                  <Database className="w-5 h-5" />
                  <h3>TPM & Tool Caching</h3>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  All tool outputs are TPM-capped at 4,000 characters and hashed in SQLite. Repeated web searches or file reads hit local cache with 0 LLM tokens and 0 API cost.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'config' && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
            <div className="flex items-center space-x-3 mb-2">
              <Settings className="w-6 h-6 text-emerald-400" />
              <div>
                <h2 className="text-lg font-bold text-slate-100">Model Limits & Quota Soft-Caps</h2>
                <p className="text-xs text-slate-400">Configured conservative limits to leave safety headroom below hard API caps.</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="p-3">Model ID</th>
                      <th className="p-3">Role</th>
                      <th className="p-3">Soft-Cap RPD</th>
                      <th className="p-3">RPM Pacing</th>
                      <th className="p-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    <tr>
                      <td className="p-3 text-emerald-400 font-bold">gemini-decision-1</td>
                      <td className="p-3 text-slate-300 font-sans">Gatekeeper (Decisions API)</td>
                      <td className="p-3">9,500</td>
                      <td className="p-3">180 RPM</td>
                      <td className="p-3"><span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Active</span></td>
                    </tr>
                    <tr>
                      <td className="p-3 text-indigo-400 font-bold">gemma-4-26b-a4b-it</td>
                      <td className="p-3 text-slate-300 font-sans">Tier-2 Workhorse</td>
                      <td className="p-3">13,500</td>
                      <td className="p-3">28 RPM</td>
                      <td className="p-3"><span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Active</span></td>
                    </tr>
                    <tr>
                      <td className="p-3 text-cyan-400 font-bold">gemini-3.5-flash-lite</td>
                      <td className="p-3 text-slate-300 font-sans">Tier-2 Fast Worker</td>
                      <td className="p-3">450</td>
                      <td className="p-3">14 RPM</td>
                      <td className="p-3"><span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Active</span></td>
                    </tr>
                    <tr>
                      <td className="p-3 text-amber-400 font-bold">gemini-4-hydrogen</td>
                      <td className="p-3 text-slate-300 font-sans">Tier-3 Strategic Planner</td>
                      <td className="p-3">18</td>
                      <td className="p-3">4 RPM</td>
                      <td className="p-3"><span className="text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Active</span></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/60 px-6 py-4 text-center text-xs text-slate-500">
        Zero-Cost Forever Gemini Agent Architecture &bull; Built for Google AI Studio Free Tier &bull; $0 Forever
      </footer>
    </div>
  );
}
