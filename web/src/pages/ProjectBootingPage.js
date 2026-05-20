/**
 * ProjectBootingPage — web mirror of /app/frontend/app/project-booting.tsx.
 *
 * "The system has already started building your product."
 *
 * Used as the destination of `EstimateResultPage`'s authed CTA and of the
 * inline-signup → auto-login → auto-project-create chain. Reaching this
 * page means a project_id exists in MongoDB; we use the same 3-step
 * theatrical reveal as mobile, then `replace` to the workspace.
 *
 * Timeline (≈3.0s total, parallel with workspace fetch):
 *   0–400ms    Header fade           "● Creating your product"
 *   400–1200ms Step 1 tick           ✓ Understanding your idea
 *   1200–2000ms Step 2 tick + modules ✓ Splitting into N modules
 *   2000–2800ms Step 3 pulse + live  ● Starting execution
 *   ~2900ms    Final ✓               ✓ Execution started
 *   3000ms     navigate(replace) → /client/project-workspace/:id
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Sparkles, CheckCircle2, Loader2 } from 'lucide-react';
import { runtime } from '@/runtime';

const STEP_TIMINGS = { s1: 500, s2: 1300, s3: 2100, done: 2900, redirect: 3000 };

const ProjectBootingPage = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const projectId = params.get('id') || '';

  const [step, setStep] = useState(0); // 0=none, 1=s1, 2=s2, 3=s3, 4=done
  const [modules, setModules] = useState([]);
  const [liveStatus, setLiveStatus] = useState({});

  // Fetch workspace in parallel — UI doesn't wait on it.
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await runtime.get(`/api/client/project/${projectId}/workspace`);
        if (cancelled) return;
        const m = Array.isArray(r?.data?.modules) ? r.data.modules : [];
        setModules(m.slice(0, 5));
      } catch {
        /* silent — booting must not depend on this */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Orchestrate the step timeline.
  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), STEP_TIMINGS.s1);
    const t2 = setTimeout(() => setStep(2), STEP_TIMINGS.s2);
    const t3 = setTimeout(() => setStep(3), STEP_TIMINGS.s3);
    const tDone = setTimeout(() => setStep(4), STEP_TIMINGS.done);
    const tGo = setTimeout(() => {
      if (projectId) {
        navigate(`/client/project-workspace/${projectId}`, { replace: true });
      } else {
        navigate('/client/dashboard', { replace: true });
      }
    }, STEP_TIMINGS.redirect);
    return () => {
      [t1, t2, t3, tDone, tGo].forEach(clearTimeout);
    };
  }, [projectId, navigate]);

  // Live activity rows — flip queued→started during step 3.
  useEffect(() => {
    if (step < 3 || modules.length === 0) return;
    setLiveStatus(
      Object.fromEntries(modules.map((m) => [m.module_id || m.title, 'queued'])),
    );
    const t1 = setTimeout(() => {
      const k = modules[0]?.module_id || modules[0]?.title;
      if (k) setLiveStatus((prev) => ({ ...prev, [k]: 'started' }));
    }, 200);
    const t2 = setTimeout(() => {
      const k = modules[1]?.module_id || modules[1]?.title;
      if (k) setLiveStatus((prev) => ({ ...prev, [k]: 'started' }));
    }, 550);
    return () => [t1, t2].forEach(clearTimeout);
  }, [step, modules]);

  const moduleCount = modules.length || 4;

  return (
    <div
      className="min-h-screen bg-background text-foreground flex items-center justify-center px-6"
      data-testid="project-booting-page"
    >
      <div className="w-full max-w-xl">
        <div className="flex items-center gap-2 mb-2" data-testid="project-booting-header">
          <span
            className="inline-block w-2 h-2 rounded-full animate-pulse"
            style={{ background: 'var(--t-signal)' }}
          />
          <span className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
            Creating your product
          </span>
        </div>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-10">
          The system has already started working.
        </h1>

        <div className="space-y-4" data-testid="project-booting-steps">
          <StepRow
            visible={step >= 1}
            done={step >= 1}
            title="Understanding your idea"
            sub="Analyzing requirements and structure"
            testId="boot-step-1"
          />
          <StepRow
            visible={step >= 2}
            done={step >= 2}
            title={`Splitting into ${moduleCount} modules`}
            sub="Mapping scope to product surfaces"
            testId="boot-step-2"
          />
          <StepRow
            visible={step >= 3}
            done={step >= 4}
            active={step === 3}
            title={step >= 4 ? 'Execution started' : 'Starting execution'}
            sub="Assigning the first work units"
            testId="boot-step-3"
          />
        </div>

        {step >= 3 && modules.length > 0 && (
          <div
            className="mt-8 rounded-xl border border-border bg-card p-4 space-y-2"
            data-testid="boot-live-activity"
          >
            <div className="text-[11px] font-semibold tracking-[0.16em] uppercase text-muted-foreground mb-1">
              Live activity
            </div>
            {modules.map((m) => {
              const k = m.module_id || m.title;
              const status = liveStatus[k] || 'queued';
              return (
                <div
                  key={k}
                  className="flex items-center justify-between text-sm"
                  data-testid={`boot-module-row-${k}`}
                >
                  <span className="truncate pr-3">{m.title}</span>
                  <span
                    className={`text-xs font-mono px-2 py-0.5 rounded-full ${
                      status === 'started'
                        ? 'bg-[var(--t-signal)]/10 text-[var(--t-signal)]'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {status === 'started' ? 'in progress' : 'queued'}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-10 text-xs text-muted-foreground flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--t-signal)' }} />
          You will land in your workspace in a moment.
        </div>
      </div>
    </div>
  );
};

const StepRow = ({ visible, done, active, title, sub, testId }) => {
  if (!visible) {
    return <div className="h-12" data-testid={`${testId}-pending`} />;
  }
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-xl border border-border bg-card transition-opacity"
      data-testid={testId}
    >
      <div className="shrink-0 mt-0.5">
        {done ? (
          <CheckCircle2 className="w-5 h-5" style={{ color: 'var(--t-signal)' }} />
        ) : active ? (
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        ) : (
          <span className="block w-5 h-5 rounded-full border border-border" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
      </div>
    </div>
  );
};

export default ProjectBootingPage;
