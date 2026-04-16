import { useEffect, useState, useCallback } from 'react';
import AdminLayout from '@/components/AdminLayout';
import { supabase, Simulation, ProcessStep, DetectionStep } from '@/lib/supabase';
import { Plus, Loader, CheckCircle, XCircle, BookOpen, Trash2, ExternalLink, AlertTriangle, Download, ChevronDown, ChevronRight, Globe, Save, ListChecks } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

type JobStatus = 'idle' | 'running' | 'complete' | 'error';

interface Job {
  job_id:        string;
  status:        string;
  progress:      number;
  current_phase: string;
  simulation_id: string | null;
  error:         string | null;
}

// ─── SCORM 1.2 package generator ────────────────────────────────────────────

async function downloadScorm(sim: Simulation) {
  const JSZip = (await import('jszip')).default;
  const steps = Array.isArray(sim.steps_json) ? sim.steps_json as any[] : [];
  const safeTitle = sim.title.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));

  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${sim.id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="org1">
    <organization identifier="org1">
      <title>${safeTitle}</title>
      <item identifier="item1" identifierref="resource1">
        <title>${safeTitle}</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="resource1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`;

  const playerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${safeTitle}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a14;color:#fff;height:100vh;display:flex;flex-direction:column;overflow:hidden;user-select:none}
#hdr{background:#0f0f1a;border-bottom:1px solid #2d2d44;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
#ttl{font-size:14px;font-weight:600;color:#e2e8f0;max-width:60%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#ctr{font-size:13px;color:#64748b;font-family:monospace}
#pb{height:3px;background:#2d2d44;flex-shrink:0}
#pf{height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);transition:width .4s}
#main{flex:1;display:flex;overflow:hidden;min-height:0}
#vis{flex:1;display:flex;align-items:center;justify-content:center;padding:16px;min-width:0}
#sw{position:relative;width:100%;max-width:900px;aspect-ratio:16/9}
#sc{position:absolute;inset:0;border-radius:10px;border:1px solid #2d2d44;overflow:hidden}
#sc.guided{cursor:default}#sc.practice{cursor:crosshair}
#si{width:100%;height:100%;object-fit:cover;display:block}
.ov{position:absolute;background:rgba(0,0,0,.5);pointer-events:none}
#hs{position:absolute;border-radius:4px;cursor:pointer}
#hp{position:absolute;inset:0;border-radius:4px;animation:ping 1.5s cubic-bezier(0,0,.2,1) infinite;background:rgba(99,102,241,.3)}
@keyframes ping{0%{transform:scale(1);opacity:.3}75%,100%{transform:scale(1.15);opacity:0}}
#fb{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:0;transition:opacity .2s}
#fb.show{opacity:1}
#fm{padding:10px 20px;border-radius:12px;font-size:14px;font-weight:600}
#fm.ok{background:rgba(34,197,94,.9)}#fm.bad{background:rgba(239,68,68,.9)}
#panel{width:270px;flex-shrink:0;border-left:1px solid #2d2d44;background:#0f0f1a;display:flex;flex-direction:column}
#pi{padding:14px;flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:12px}
#sc2{background:#1a1a2e;border:1px solid #2d2d44;border-radius:10px;padding:14px}
#slbl{font-size:11px;color:#818cf8;font-family:monospace;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
#sins{font-size:13px;font-weight:600;color:#e2e8f0;line-height:1.5}
#sh{font-size:12px;color:#fbbf24;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.2);border-radius:8px;padding:8px;margin-top:8px;display:none}
#hb{background:none;border:none;color:#64748b;font-size:12px;cursor:pointer;padding:0;margin-top:6px}
#hb:hover{color:#fbbf24}
#mb{padding:10px 14px;border-top:1px solid #2d2d44;flex-shrink:0}
.mbs{display:flex;gap:3px;background:#0a0a14;border:1px solid #2d2d44;border-radius:8px;padding:3px}
.mb{flex:1;padding:5px;border:none;border-radius:5px;font-size:11px;font-weight:600;cursor:pointer;background:none;color:#64748b}
.mb.on{background:#6366f1;color:#fff}
#nav{padding:12px 14px;border-top:1px solid #2d2d44;flex-shrink:0}
#bn{width:100%;padding:10px;background:#6366f1;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer}
#bn:hover{background:#4f46e5}#bn:disabled{opacity:.5;cursor:default}
#fin{display:none;position:fixed;inset:0;background:rgba(10,10,20,.95);align-items:center;justify-content:center;z-index:50}
#fin.show{display:flex}
#fc{background:#1a1a2e;border:1px solid #2d2d44;border-radius:20px;padding:36px;text-align:center;max-width:340px;width:90%}
#fi{width:60px;height:60px;background:rgba(34,197,94,.2);border:1px solid rgba(34,197,94,.3);border-radius:14px;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;font-size:26px}
#ft{font-size:22px;font-weight:800;margin-bottom:6px}
#fs{font-size:13px;color:#64748b;margin-bottom:20px}
.sg{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px}
.sb{background:#0a0a14;border-radius:10px;padding:10px}
.sv{font-size:19px;font-weight:800;font-family:monospace}
.sl{font-size:11px;color:#64748b;margin-top:3px}
#rb{width:100%;padding:11px;background:#6366f1;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer}
#rb:hover{background:#4f46e5}
</style>
</head>
<body>
<div id="hdr">
  <div id="ttl">${safeTitle}</div>
  <div id="ctr">1 / ${steps.length}</div>
</div>
<div id="pb"><div id="pf" style="width:0%"></div></div>
<div id="main">
  <div id="vis">
    <div id="sw">
      <div id="sc" class="guided">
        <img id="si" src="" alt="" draggable="false">
        <div id="ot" class="ov"></div>
        <div id="ob" class="ov"></div>
        <div id="ol" class="ov"></div>
        <div id="or" class="ov"></div>
        <div id="hs"><div id="hp"></div></div>
        <div id="fb"><div id="fm"></div></div>
      </div>
    </div>
  </div>
  <div id="panel">
    <div id="pi">
      <div id="sc2">
        <div id="slbl">Step 1 · click</div>
        <div id="sins"></div>
        <button id="hb" onclick="toggleHint()">💡 Show hint</button>
        <div id="sh"></div>
      </div>
    </div>
    <div id="mb">
      <div class="mbs">
        <button class="mb on" id="bg" onclick="setMode('guided')">📖 Guided</button>
        <button class="mb" id="bp" onclick="setMode('practice')">🎓 Practice</button>
      </div>
    </div>
    <div id="nav"><button id="bn" onclick="advance()">Next →</button></div>
  </div>
</div>
<div id="fin">
  <div id="fc">
    <div id="fi">✓</div>
    <div id="ft">Complete!</div>
    <div id="fs">${safeTitle}</div>
    <div class="sg">
      <div class="sb"><div class="sv" id="ssc">-</div><div class="sl">Score</div></div>
      <div class="sb"><div class="sv" id="stm">-</div><div class="sl">Time</div></div>
      <div class="sb"><div class="sv">${steps.length}</div><div class="sl">Steps</div></div>
    </div>
    <button id="rb" onclick="restart()">Retry</button>
  </div>
</div>
<script>
var STEPS=${JSON.stringify(steps)};
var cur=0,mode='guided',wrong=0,t0=Date.now(),hintOn=false;

// SCORM 1.2
var SAPI=null;
function findAPI(w){try{if(w.API)return w.API;if(w.parent&&w.parent!==w)return findAPI(w.parent);}catch(e){}return null;}
window.addEventListener('load',function(){SAPI=findAPI(window);if(SAPI)SAPI.LMSInitialize('');render();});
window.addEventListener('beforeunload',function(){if(SAPI)SAPI.LMSFinish('');});
function scormDone(score){if(!SAPI)return;SAPI.LMSSetValue('cmi.core.score.raw',''+score);SAPI.LMSSetValue('cmi.core.score.min','0');SAPI.LMSSetValue('cmi.core.score.max','100');SAPI.LMSSetValue('cmi.core.lesson_status',score>=70?'passed':'failed');SAPI.LMSFinish('');}

function $(id){return document.getElementById(id);}
function render(){
  if(cur>=STEPS.length){finish();return;}
  var s=STEPS[cur],h=s.hotspot;
  $('pf').style.width=(cur/STEPS.length*100)+'%';
  $('ctr').textContent=(cur+1)+' / '+STEPS.length;
  $('slbl').textContent='Step '+(s.stepNumber||cur+1)+' · '+(s.action||'click');
  $('sins').textContent=s.instruction||'';
  hintOn=false;$('sh').style.display='none';$('sh').textContent=s.hint||'';
  $('hb').style.display=s.hint?'block':'none';$('hb').textContent='💡 Show hint';
  $('si').src=s.slideImage||s.screenshot||'';
  $('fb').className='';
  var sc=$('sc');
  sc.className=mode==='practice'?'practice':'guided';
  if(h){
    var showH=(mode==='guided');
    var hs=$('hs');
    hs.style.display=showH?'block':'none';
    hs.style.cssText='left:'+h.xPct+'%;top:'+h.yPct+'%;width:'+h.widthPct+'%;height:'+h.heightPct+'%;position:absolute;border-radius:4px;cursor:pointer;box-shadow:0 0 0 3px rgba(99,102,241,.9),0 0 0 6px rgba(99,102,241,.3);display:'+(showH?'block':'none');
    setOvs(h,mode==='guided');
    sc.onclick=function(e){
      if(mode!=='practice')return;
      var r=sc.getBoundingClientRect();
      var xp=((e.clientX-r.left)/r.width)*100,yp=((e.clientY-r.top)/r.height)*100,tol=3;
      var hit=xp>=h.xPct-tol&&xp<=h.xPct+h.widthPct+tol&&yp>=h.yPct-tol&&yp<=h.yPct+h.heightPct+tol;
      if(hit)onOk();else onBad();
    };
    hs.onclick=function(e){e.stopPropagation();onOk();};
    $('bn').disabled=(mode==='practice');
    $('bn').textContent=mode==='practice'?'Click to advance':(cur===STEPS.length-1?'✓ Finish':'Next →');
  } else {
    $('hs').style.display='none';setOvs(null,false);
    sc.onclick=null;
    $('bn').disabled=false;
    $('bn').textContent=cur===STEPS.length-1?'✓ Finish':'Next →';
  }
}
function setOvs(h,show){
  var ids=['ot','ob','ol','or'];
  if(!show||!h){ids.forEach(function(id){$(id).style.display='none';});return;}
  $('ot').style.cssText='position:absolute;background:rgba(0,0,0,.5);pointer-events:none;top:0;left:0;right:0;height:'+h.yPct+'%';
  $('ob').style.cssText='position:absolute;background:rgba(0,0,0,.5);pointer-events:none;top:'+(h.yPct+h.heightPct)+'%;left:0;right:0;bottom:0';
  $('ol').style.cssText='position:absolute;background:rgba(0,0,0,.5);pointer-events:none;top:'+h.yPct+'%;left:0;width:'+h.xPct+'%;height:'+h.heightPct+'%';
  $('or').style.cssText='position:absolute;background:rgba(0,0,0,.5);pointer-events:none;top:'+h.yPct+'%;left:'+(h.xPct+h.widthPct)+'%;right:0;height:'+h.heightPct+'%';
}
function flash(cls,msg,cb){
  var fb=$('fb'),fm=$('fm');
  fm.className=cls;fm.textContent=msg;fb.className='show';
  setTimeout(function(){fb.className='';if(cb)cb();},700);
}
function onOk(){flash('ok','✓ Correct!',function(){wrong=0;advance();});}
function onBad(){
  wrong++;
  flash('bad','Not quite — try again',null);
  if(wrong>=3){$('hs').style.display='block';}
}
function advance(){cur++;wrong=0;render();}
function toggleHint(){
  hintOn=!hintOn;
  $('sh').style.display=hintOn?'block':'none';
  $('hb').textContent=hintOn?'💡 Hide hint':'💡 Show hint';
  if(hintOn)$('hs').style.display='block';
}
function setMode(m){
  mode=m;
  $('bg').className='mb'+(m==='guided'?' on':'');
  $('bp').className='mb'+(m==='practice'?' on':'');
  render();
}
function finish(){
  var el=Math.round((Date.now()-t0)/1000),m=Math.floor(el/60),s=el%60;
  var score=Math.max(0,100-wrong*10);
  $('ssc').textContent=score+'%';
  $('stm').textContent=m+':'+(s<10?'0':'')+s;
  $('fin').className='show';
  scormDone(score);
}
function restart(){cur=0;wrong=0;t0=Date.now();$('fin').className='';render();}
</script>
</body>
</html>`;

  const zip = new JSZip();
  zip.file('imsmanifest.xml', manifest);
  zip.file('index.html', playerHtml);

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sim.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_scorm12.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProcessEntry {
  processName:    string;
  hub:            string | null;
  // detection steps (from process_steps table)
  stepsId:        string | null;
  stepsSource:    string | null;
  detectionSteps: DetectionStep[];
  stepsPublished: boolean;
  // simulation (from simulations table, optional)
  sim:            Simulation | null;
}

// ─── Inline step editor ───────────────────────────────────────────────────────

function StepsSection({ entry, onSaved }: { entry: ProcessEntry; onSaved: (steps: DetectionStep[], stepsId: string) => void }) {
  const [open,    setOpen]    = useState(false);
  const [editing, setEditing] = useState(false);
  const [steps,   setSteps]   = useState<DetectionStep[]>(entry.detectionSteps);
  const [saving,  setSaving]  = useState(false);

  useEffect(() => { setSteps(entry.detectionSteps); }, [entry.detectionSteps]);

  const save = async () => {
    setSaving(true);
    const payload = {
      process_name: entry.processName,
      hub:          entry.hub || null,
      source:       entry.stepsId ? (entry.stepsSource || 'manual') : 'manual',
      steps:        steps.map((s, i) => ({ order: i + 1, elementText: s.elementText.trim(), urlPattern: s.urlPattern.trim() })),
      published:    entry.stepsPublished,
      updated_at:   new Date().toISOString(),
    };
    let id = entry.stepsId;
    if (id) {
      await supabase.from('process_steps').update(payload).eq('id', id);
    } else {
      const { data } = await supabase.from('process_steps').insert(payload).select('id').single();
      id = data?.id ?? null;
    }
    setSaving(false);
    setEditing(false);
    if (id) onSaved(steps, id);
  };

  const addStep  = () => setSteps(s => [...s, { order: s.length + 1, elementText: '', urlPattern: '' }]);
  const delStep  = (i: number) => setSteps(s => s.filter((_, idx) => idx !== i).map((x, idx) => ({ ...x, order: idx + 1 })));
  const setStep  = (i: number, field: keyof DetectionStep, val: string) =>
    setSteps(s => s.map((x, idx) => idx === i ? { ...x, [field]: val } : x));

  const sourceColor: Record<string, string> = { gemini: '#9747FF', ppt: '#f59e0b', manual: '#22c55e' };
  const src = entry.stepsSource || 'manual';

  return (
    <div style={{ borderTop: '1px solid #f3f4f6', marginTop: 4, paddingTop: 10 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => { if (!editing) setOpen(o => !o); }}>
        {open ? <ChevronDown size={13} color="#9ca3af" /> : <ChevronRight size={13} color="#9ca3af" />}
        <ListChecks size={13} color="#9ca3af" />
        <span style={{ fontSize: 12, color: '#555', fontWeight: 600 }}>
          Detection Steps
          <span style={{ fontWeight: 400, color: '#aaa', marginLeft: 4 }}>({steps.length})</span>
        </span>
        {entry.stepsId && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 10,
            background: `${sourceColor[src]}18`, color: sourceColor[src], textTransform: 'uppercase' }}>
            {src}
          </span>
        )}
        {!entry.stepsId && (
          <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 600 }}>no steps yet</span>
        )}
        <div style={{ marginLeft: 'auto' }} onClick={e => e.stopPropagation()}>
          {editing ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => { setEditing(false); setSteps(entry.detectionSteps); }}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', color: '#666' }}>
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: 'none',
                  background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 4 }}>
                <Save size={10} /> {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          ) : (
            <button onClick={() => { setOpen(true); setEditing(true); }}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid #e5e7eb',
                background: '#fff', cursor: 'pointer', color: '#666' }}>
              Edit
            </button>
          )}
        </div>
      </div>

      {/* Step list */}
      {open && (
        <div style={{ marginTop: 8, paddingLeft: 21 }}>
          {steps.length === 0 && !editing && (
            <div style={{ fontSize: 11, color: '#ccc', paddingBottom: 4 }}>No steps configured — click Edit to add</div>
          )}
          {steps.map((step, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%',
                background: 'linear-gradient(135deg,#F43397,#9747FF)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 9, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{i + 1}</span>
              {editing ? (
                <>
                  <input value={step.elementText} onChange={e => setStep(i, 'elementText', e.target.value)}
                    placeholder="Element text"
                    style={{ flex: 2, padding: '4px 8px', borderRadius: 5, border: '1px solid #e5e7eb', fontSize: 11 }} />
                  <Globe size={10} color="#9ca3af" />
                  <input value={step.urlPattern} onChange={e => setStep(i, 'urlPattern', e.target.value)}
                    placeholder="url fragment"
                    style={{ flex: 1, padding: '4px 8px', borderRadius: 5, border: '1px solid #e5e7eb', fontSize: 11 }} />
                  <button onClick={() => delStep(i)}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#d1d5db', padding: 2 }}>
                    <Trash2 size={11} />
                  </button>
                </>
              ) : (
                <span style={{ fontSize: 11, color: '#444' }}>
                  {step.elementText}
                  {step.urlPattern && <span style={{ color: '#9ca3af', marginLeft: 6 }}>/{step.urlPattern}</span>}
                </span>
              )}
            </div>
          ))}
          {editing && (
            <button onClick={addStep}
              style={{ marginTop: 4, fontSize: 11, padding: '4px 10px', borderRadius: 5,
                border: '1px dashed #d1d5db', background: 'none', cursor: 'pointer', color: '#9ca3af',
                display: 'flex', alignItems: 'center', gap: 4 }}>
              <Plus size={10} /> Add Step
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ContentPage() {
  const [entries,     setEntries]     = useState<ProcessEntry[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [slidesUrl,   setSlidesUrl]   = useState('');
  const [processName, setProcessName] = useState('');
  const [hub,         setHub]         = useState('');
  const [jobStatus,   setJobStatus]   = useState<JobStatus>('idle');
  const [job,         setJob]         = useState<Job | null>(null);
  const [formOpen,    setFormOpen]    = useState(false);
  const [exporting,   setExporting]   = useState<string | null>(null);

  const load = useCallback(async () => {
    const [simsRes, stepsRes] = await Promise.all([
      supabase.from('simulations').select('*').order('created_at', { ascending: false }),
      supabase.from('process_steps').select('*').order('process_name'),
    ]);
    const sims  = (simsRes.data  as Simulation[]   ) || [];
    const steps = (stepsRes.data as ProcessStep[]  ) || [];

    // Build merged map keyed by process_name
    const map = new Map<string, ProcessEntry>();

    for (const sim of sims) {
      const key = sim.process_name || sim.title;
      map.set(key, {
        processName: key, hub: sim.hub,
        stepsId: null, stepsSource: null, detectionSteps: [], stepsPublished: true,
        sim,
      });
    }
    for (const ps of steps) {
      const key = ps.process_name;
      const existing = map.get(key);
      map.set(key, {
        ...(existing ?? { processName: key, hub: ps.hub, sim: null }),
        stepsId:        ps.id,
        stepsSource:    ps.source,
        detectionSteps: (ps.steps as DetectionStep[]) || [],
        stepsPublished: ps.published,
        hub:            ps.hub ?? existing?.hub ?? null,
      });
    }

    setEntries(Array.from(map.values()));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll job status
  useEffect(() => {
    if (!job?.job_id || jobStatus !== 'running') return;
    const interval = setInterval(async () => {
      try {
        const res  = await fetch(`${API}/api/jobs/${job.job_id}`);
        const data: Job = await res.json();
        setJob(data);
        if (data.status === 'complete') {
          setJobStatus('complete');
          clearInterval(interval);
          if (data.simulation_id) {
            const simRes  = await fetch(`${API}/api/simulations/${data.simulation_id}`);
            const simData = await simRes.json();
            await supabase.from('simulations').upsert({
              id:           simData.id,
              title:        simData.title,
              process_name: processName || null,
              hub:          hub || null,
              step_count:   simData.stepCount,
              steps_json:   simData.steps,
              created_by:   'admin',
              created_at:   new Date().toISOString(),
            });
            load();
          }
        } else if (data.status === 'error') {
          setJobStatus('error');
          clearInterval(interval);
        }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [job, jobStatus, processName, hub, load]);

  const generate = async () => {
    if (!slidesUrl.trim()) return;
    setJobStatus('running');
    setFormOpen(false);
    try {
      const res  = await fetch(`${API}/api/generate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ slides_url: slidesUrl, process_name: processName || null, hub: hub || null }),
      });
      const data: Job = await res.json();
      setJob(data);
    } catch {
      setJobStatus('error');
      setJob({ job_id: '', status: 'error', progress: 0, current_phase: '', simulation_id: null, error: 'Could not reach the simulation backend.' });
    }
  };

  const addManualProcess = async () => {
    const name = prompt('Process name (e.g. RTO Bagging):')?.trim();
    if (!name) return;
    await supabase.from('process_steps').insert({
      process_name: name, hub: null, source: 'manual', steps: [], published: true,
    });
    load();
  };

  // ── PPT import ──
  const [pptForm, setPptForm]     = useState(false);
  const [pptName, setPptName]     = useState('');
  const [pptHub,  setPptHub]      = useState('');
  const [pptFile, setPptFile]     = useState<File | null>(null);
  const [pptUrl,  setPptUrl]      = useState('');
  const [pptBusy, setPptBusy]     = useState(false);
  const [pptError, setPptError]   = useState('');

  const importPpt = async () => {
    if (!pptName.trim()) { setPptError('Process name required'); return; }
    if (!pptFile && !pptUrl.trim()) { setPptError('Upload a file or paste a Drive URL'); return; }
    setPptBusy(true); setPptError('');
    try {
      const fd = new FormData();
      fd.append('process_name', pptName.trim());
      if (pptHub) fd.append('hub', pptHub);
      if (pptFile) fd.append('file', pptFile);
      else         fd.append('drive_url', pptUrl.trim());

      const res = await fetch(`${API}/api/import-ppt`, { method: 'POST', body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Import failed');
      }
      setPptForm(false); setPptName(''); setPptHub(''); setPptFile(null); setPptUrl('');
      load();
    } catch (e: any) {
      setPptError(e.message);
    } finally {
      setPptBusy(false);
    }
  };

  const deleteEntry = async (entry: ProcessEntry) => {
    const label = entry.sim ? 'Delete this process and its simulation?' : 'Delete this process?';
    if (!confirm(label)) return;
    if (entry.sim)    await supabase.from('simulations').delete().eq('id', entry.sim.id);
    if (entry.stepsId) await supabase.from('process_steps').delete().eq('id', entry.stepsId);
    setEntries(e => e.filter(x => x.processName !== entry.processName));
  };

  const togglePublish = async (entry: ProcessEntry) => {
    const next = !entry.stepsPublished;
    if (entry.stepsId) {
      await supabase.from('process_steps').update({ published: next }).eq('id', entry.stepsId);
      setEntries(e => e.map(x => x.processName === entry.processName ? { ...x, stepsPublished: next } : x));
    }
  };

  const handleScormExport = async (sim: Simulation) => {
    setExporting(sim.id);
    try { await downloadScorm(sim); } finally { setExporting(null); }
  };

  const onStepsSaved = (processName: string, steps: DetectionStep[], stepsId: string) => {
    setEntries(e => e.map(x => x.processName === processName
      ? { ...x, detectionSteps: steps, stepsId, stepsSource: x.stepsSource || 'manual' }
      : x
    ));
  };

  return (
    <AdminLayout title="Processes">
      {/* Generation status banners */}
      {jobStatus === 'running' && job && (
        <div style={{ background: 'rgba(151,71,255,0.08)', border: '1px solid rgba(151,71,255,0.2)', borderRadius: 12, padding: '16px 20px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
          <Loader size={18} color="#9747FF" style={{ animation: 'spin 1s linear infinite' }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: '#1a1a2e', fontSize: 13 }}>Generating simulation…</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{job.current_phase} · {job.progress}%</div>
          </div>
          <div style={{ height: 6, width: 140, background: '#e8eaed', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${job.progress}%`, background: 'linear-gradient(90deg,#F43397,#9747FF)', borderRadius: 3, transition: 'width 0.3s' }} />
          </div>
        </div>
      )}
      {jobStatus === 'complete' && (
        <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 12, padding: '14px 20px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
          <CheckCircle size={18} color="#22c55e" />
          <span style={{ fontSize: 13, color: '#1a1a2e', fontWeight: 600 }}>Simulation generated — steps auto-populated for PCT detection.</span>
          <button onClick={() => { setJobStatus('idle'); setJob(null); setSlidesUrl(''); setProcessName(''); setHub(''); }} style={{ marginLeft: 'auto', fontSize: 12, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}
      {jobStatus === 'error' && (
        <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '14px 20px', marginBottom: 20, display: 'flex', gap: 10, alignItems: 'center' }}>
          <XCircle size={18} color="#ef4444" />
          <span style={{ fontSize: 13, color: '#1a1a2e' }}>{job?.error || 'Generation failed.'}</span>
          <button onClick={() => { setJobStatus('idle'); setJob(null); }} style={{ marginLeft: 'auto', fontSize: 12, color: '#888', background: 'none', border: 'none', cursor: 'pointer' }}>Dismiss</button>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 13, color: '#888' }}>{entries.length} process{entries.length !== 1 ? 'es' : ''}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={addManualProcess} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', background: '#fff', color: '#555', border: '1.5px solid #e8eaed', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <Plus size={14} /> New Process
          </button>
          <button onClick={() => { setPptForm(v => !v); setFormOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 14px', background: '#fff', color: '#555', border: '1.5px solid #e8eaed', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <Download size={14} /> Import PPT
          </button>
          <button onClick={() => { setFormOpen(v => !v); setPptForm(false); }} disabled={jobStatus === 'running'} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: jobStatus === 'running' ? 0.6 : 1 }}>
            <Plus size={14} /> Generate Simulation
          </button>
        </div>
      </div>

      {/* Import PPT form */}
      {pptForm && (
        <div style={{ background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 16 }}>Import Steps from PPTX</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Process Name *</label>
              <input value={pptName} onChange={e => setPptName(e.target.value)} placeholder="e.g. RTO Bagging" style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Hub (optional)</label>
              <select value={pptHub} onChange={e => setPptHub(e.target.value)} style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, background: '#fff', boxSizing: 'border-box' as const }}>
                <option value="">All hubs</option>
                {['Mumbai','Delhi','Bengaluru','Hyderabad','Chennai','Kolkata','Pune','Ahmedabad','Jaipur','Lucknow'].map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>PPTX File</label>
              <input type="file" accept=".pptx,.ppt" onChange={e => { setPptFile(e.target.files?.[0] ?? null); setPptUrl(''); }} style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>— or Google Slides / Drive URL</label>
              <input value={pptUrl} onChange={e => { setPptUrl(e.target.value); setPptFile(null); }} placeholder="https://docs.google.com/presentation/d/...  or  https://drive.google.com/file/d/..." style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
          </div>
          {pptError && <div style={{ marginTop: 12, fontSize: 12, color: '#ef4444' }}>{pptError}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={importPpt} disabled={pptBusy} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: pptBusy ? 0.6 : 1 }}>
              {pptBusy ? 'Importing…' : 'Import'}
            </button>
            <button onClick={() => { setPptForm(false); setPptError(''); }} style={{ padding: '10px 18px', background: '#f5f5f5', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#555' }}>Cancel</button>
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 10 }}>PPT must use red-outlined boxes to mark click targets. Slides/Drive file must be shared as "Anyone with link (View)".</div>
        </div>
      )}

      {/* Generate form */}
      {formOpen && (
        <div style={{ background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 4px 20px rgba(0,0,0,0.1)', marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a2e', marginBottom: 20 }}>Generate Simulation from Google Slides</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Google Slides URL *</label>
              <input value={slidesUrl} onChange={e => setSlidesUrl(e.target.value)} placeholder="https://docs.google.com/presentation/d/..." style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Process Name</label>
              <input value={processName} onChange={e => setProcessName(e.target.value)} placeholder="e.g. RTO Bagging" style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, display: 'block', marginBottom: 6 }}>Hub (optional)</label>
              <select value={hub} onChange={e => setHub(e.target.value)} style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e8eaed', borderRadius: 8, fontSize: 13, background: '#fff', boxSizing: 'border-box' as const }}>
                <option value="">All hubs</option>
                {['Mumbai','Delhi','Bengaluru','Hyderabad','Chennai','Kolkata','Pune','Ahmedabad','Jaipur','Lucknow'].map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <button onClick={generate} disabled={!slidesUrl.trim()} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#F43397,#9747FF)', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: !slidesUrl.trim() ? 0.5 : 1 }}>Generate</button>
            <button onClick={() => setFormOpen(false)} style={{ padding: '10px 18px', background: '#f5f5f5', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#555' }}>Cancel</button>
          </div>
          <div style={{ fontSize: 11, color: '#aaa', marginTop: 12 }}>
            Make sure the deck is publicly accessible. Backend: <code style={{ background: '#f5f5f5', padding: '1px 4px', borderRadius: 3 }}>{API}</code>
          </div>
        </div>
      )}

      {/* Process cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#bbb' }}>Loading…</div>
      ) : entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb' }}>
          <BookOpen size={40} style={{ marginBottom: 16, opacity: 0.3 }} />
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>No processes yet</div>
          <div style={{ fontSize: 13 }}>Add a process manually or generate one from a Google Slides deck.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {entries.map(entry => (
            <div key={entry.processName} style={{ background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Title row */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: '#1a1a2e', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.processName}</div>
                  {entry.hub && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>📍 {entry.hub}</div>}
                </div>
                <button onClick={() => deleteEntry(entry)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e5e7eb', padding: 4, flexShrink: 0 }}>
                  <Trash2 size={14} />
                </button>
              </div>

              {/* Simulation section */}
              {entry.sim ? (
                <>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(151,71,255,0.08)', color: '#9747FF' }}>
                      {entry.sim.step_count} training steps
                    </span>
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: '#f0f0f0', color: '#555' }}>
                      {new Date(entry.sim.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                    {Array.isArray(entry.sim.steps_json) && (entry.sim.steps_json as any[]).some((s: any) => s.needsReview) && (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontWeight: 700 }}>⚠ needs review</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <a href={`/sim/${entry.sim.id}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#9747FF', textDecoration: 'none', fontSize: 12, fontWeight: 600 }}>
                      <ExternalLink size={11} /> Preview
                    </a>
                    <button onClick={() => handleScormExport(entry.sim!)} disabled={exporting === entry.sim.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 6, color: '#6366f1', fontSize: 11, fontWeight: 700, cursor: 'pointer', opacity: exporting === entry.sim.id ? 0.5 : 1 }}>
                      <Download size={10} /> {exporting === entry.sim.id ? 'Exporting…' : 'SCORM'}
                    </button>
                    <a href={`/admin/simulations/${entry.sim.id}/review`}
                      style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px',
                        background: Array.isArray(entry.sim.steps_json) && (entry.sim.steps_json as any[]).some((s: any) => s.needsReview) ? 'rgba(245,158,11,0.12)' : '#f5f5f5',
                        border: `1px solid ${Array.isArray(entry.sim.steps_json) && (entry.sim.steps_json as any[]).some((s: any) => s.needsReview) ? 'rgba(245,158,11,0.3)' : '#e8eaed'}`,
                        borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: 'none',
                        color: Array.isArray(entry.sim.steps_json) && (entry.sim.steps_json as any[]).some((s: any) => s.needsReview) ? '#f59e0b' : '#888' }}>
                      {Array.isArray(entry.sim.steps_json) && (entry.sim.steps_json as any[]).some((s: any) => s.needsReview) ? <><AlertTriangle size={10} /> Review</> : 'Edit'}
                    </a>
                    <button onClick={() => togglePublish(entry)} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px',
                      background: entry.stepsPublished ? 'rgba(34,197,94,0.1)' : 'rgba(0,0,0,0.04)',
                      border: `1px solid ${entry.stepsPublished ? 'rgba(34,197,94,0.3)' : '#e8eaed'}`,
                      borderRadius: 6, color: entry.stepsPublished ? '#16a34a' : '#aaa', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      {entry.stepsPublished ? '● Live' : '○ Draft'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: '#ccc', fontStyle: 'italic' }}>Steps only — no simulation</div>
              )}

              {/* Detection steps inline editor */}
              <StepsSection entry={entry} onSaved={(steps, id) => onStepsSaved(entry.processName, steps, id)} />
            </div>
          ))}
        </div>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </AdminLayout>
  );
}
