import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import { ArrowLeft, ArrowRight, Loader2, Sparkles, Lightbulb, Code, Palette, Database, Search, Zap, CheckCircle2, Brain, FileText, Clock, DollarSign, XCircle } from 'lucide-react';

const NewRequest = () => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [matches, setMatches] = useState(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [generatedScope, setGeneratedScope] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [step, setStep] = useState('idea'); // idea | matches | scope | submit
  
  const { user } = useAuth();
  const navigate = useNavigate();

  // Debounced template matching
  const findTemplates = useCallback(async (text) => {
    if (text.length < 20) {
      setMatches(null);
      return;
    }
    setMatchLoading(true);
    try {
      const res = await axios.post(`${API}/ai/match-template`, { idea: text }, { withCredentials: true });
      setMatches(res.data);
    } catch (err) {
      console.error('Match error:', err);
    } finally {
      setMatchLoading(false);
    }
  }, []);

  // Trigger matching when user stops typing
  useEffect(() => {
    if (step !== 'idea') return;
    const timer = setTimeout(() => {
      if (input.trim().length >= 20) {
        findTemplates(input.trim());
      }
    }, 800);
    return () => clearTimeout(timer);
  }, [input, findTemplates, step]);

  const handleGenerateScope = async (templateId = null) => {
    setGenerating(true);
    setStep('scope');
    try {
      const res = await axios.post(`${API}/ai/generate-scope`, {
        idea: input.trim(),
        template_id: templateId
      }, { withCredentials: true });
      setGeneratedScope(res.data);
    } catch (err) {
      setError('AI generation failed. You can still submit your idea directly.');
      setStep('matches');
    } finally {
      setGenerating(false);
    }
  };

  const handleSubmit = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setError('');
    
    try {
      const payload = {
        title: input.slice(0, 100),
        description: input,
        business_idea: input,
      };
      
      // Attach generated scope if available
      if (generatedScope?.scope) {
        payload.ai_scope = generatedScope.scope;
        payload.template_used = generatedScope.template_used;
      }
      if (selectedTemplate) {
        payload.matched_template_id = selectedTemplate.template_id;
      }
      
      await axios.post(`${API}/requests`, payload, { withCredentials: true });
      navigate('/client/dashboard', { state: { requestCreated: true } });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create request');
      setLoading(false);
    }
  };

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    handleGenerateScope(template.template_id);
  };

  const handleGenerateCustom = () => {
    setSelectedTemplate(null);
    handleGenerateScope(null);
  };

  const handleDirectSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    
    // If we have matches, go to match step. Otherwise submit directly
    if (matches && matches.matches && matches.matches.length > 0 && step === 'idea') {
      setStep('matches');
      return;
    }
    
    // Direct submit
    setLoading(true);
    setError('');
    try {
      await axios.post(`${API}/requests`, {
        title: input.slice(0, 100),
        description: input,
        business_idea: input,
      }, { withCredentials: true });
      navigate('/client/dashboard', { state: { requestCreated: true } });
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create request');
      setLoading(false);
    }
  };

  const examples = [
    { icon: Palette, text: "A SaaS dashboard for tracking team productivity" },
    { icon: Code, text: "Mobile app for booking fitness classes" },
    { icon: Database, text: "E-commerce platform for handmade goods" },
    { icon: Lightbulb, text: "Internal tool for managing customer support tickets" }
  ];

  const getScoreColor = (score) => {
    if (score >= 0.75) return 'text-emerald-400';
    if (score >= 0.5) return 'text-amber-400';
    return 'text-zinc-400';
  };

  const getScorePercent = (score) => Math.round(score * 100);

  return (
    <div className="min-h-screen bg-app text-white p-8" data-testid="new-request-page">
      
      <div className="relative max-w-2xl mx-auto">
        {/* Back button */}
        <button 
          onClick={() => {
            if (step === 'matches') { setStep('idea'); return; }
            if (step === 'scope') { setStep('matches'); setGeneratedScope(null); return; }
            navigate('/client/dashboard');
          }}
          className="flex items-center gap-2 text-muted-foreground hover:text-white mb-12 transition-colors"
          data-testid="back-btn"
        >
          <ArrowLeft className="w-4 h-4" />
          {step === 'idea' ? 'Back to Dashboard' : step === 'matches' ? 'Back to Idea' : 'Back to Templates'}
        </button>

        {/* ============ STEP 1: IDEA INPUT ============ */}
        {step === 'idea' && (
          <form onSubmit={handleDirectSubmit}>
            <div className="mb-10">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted border border-border backdrop-blur-sm mb-6">
                <Sparkles className="w-4 h-4 text-signal" />
                <span className="text-xs text-muted-foreground font-medium tracking-wide uppercase">New Project</span>
              </div>
              <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-4">
                What do you want<br />
                <span className="text-signal">to build?</span>
              </h1>
              <p className="text-lg text-muted-foreground">
                Describe your idea. AI will find similar past projects to accelerate delivery.
              </p>
            </div>

            <div className="rounded-2xl border border-border bg-surface-raised overflow-hidden mb-6">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="I want to build a marketplace for vintage cars where sellers can list their vehicles with detailed history, and buyers can browse, filter, and make offers..."
                className="w-full min-h-[200px] bg-transparent p-6 text-white placeholder:text-muted-foreground focus:outline-none resize-none text-lg"
                data-testid="idea-input"
                autoFocus
              />
              <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-between bg-white/[0.02]">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  {matchLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-signal" />
                      <span className="text-signal">Searching similar projects...</span>
                    </>
                  ) : matches && matches.matches?.length > 0 ? (
                    <>
                      <Brain className="w-4 h-4 text-emerald-400" />
                      <span className="text-emerald-400">{matches.matches.length} similar projects found</span>
                    </>
                  ) : input.length >= 20 ? (
                    <>
                      <Search className="w-4 h-4" />
                      <span>AI will match your idea to past projects</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Keep typing to activate AI matching</span>
                    </>
                  )}
                </div>
                <span className="text-muted-foreground text-sm font-mono">{input.length}</span>
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-6">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="w-full bg-signal hover:bg-signal text-white py-5 rounded-2xl font-semibold flex items-center justify-center gap-3 transition-all shadow-lg shadow-signal/25 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
              data-testid="submit-btn"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : matches && matches.matches?.length > 0 ? (
                <>
                  <Brain className="w-5 h-5" />
                  View Similar Projects
                  <ArrowRight className="w-5 h-5" />
                </>
              ) : (
                <>
                  Start Project
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>

            {/* Example Ideas */}
            <div className="mt-16">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-6">Example Ideas</h3>
              <div className="grid gap-3">
                {examples.map((example, i) => {
                  const Icon = example.icon;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setInput(example.text)}
                      className="w-full text-left p-5 rounded-2xl border border-border bg-[var(--t-surface-raised)] hover:border-signal/30 hover:bg-signal-soft transition-all group flex items-center gap-4"
                    >
                      <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center group-hover:bg-signal/10 transition-colors">
                        <Icon className="w-5 h-5 text-muted-foreground group-hover:text-signal transition-colors" />
                      </div>
                      <span className="text-muted-foreground group-hover:text-white transition-colors">{example.text}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </form>
        )}

        {/* ============ STEP 2: TEMPLATE MATCHES ============ */}
        {step === 'matches' && (
          <div data-testid="template-matches-step">
            <div className="mb-10">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-sm mb-6">
                <Brain className="w-4 h-4 text-emerald-400" />
                <span className="text-xs text-emerald-400 font-medium tracking-wide uppercase">AI Template Matcher</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
                We found similar projects
              </h1>
              <p className="text-lg text-muted-foreground">
                Using a template accelerates delivery and improves accuracy.
              </p>
            </div>

            {/* Your idea */}
            <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] p-5 mb-6">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Your Idea</div>
              <p className="text-muted-foreground">{input}</p>
            </div>

            {/* Template cards */}
            <div className="space-y-4 mb-8">
              {matches?.matches?.map((match, i) => (
                <div
                  key={match.template_id}
                  className={`rounded-2xl border p-6 transition-all cursor-pointer group ${
                    match.similarity >= 0.75 
                      ? 'border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-400/50'
                      : match.similarity >= 0.5
                        ? 'border-amber-500/20 bg-amber-500/5 hover:border-amber-400/40'
                        : 'border-border bg-[var(--t-surface-raised)] hover:border-border'
                  }`}
                  data-testid={`template-match-${i}`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold">{match.name}</h3>
                        {i === 0 && match.similarity >= 0.75 && (
                          <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-500/20 text-emerald-400 font-medium">Best Match</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{match.description}</p>
                    </div>
                    <div className="text-right flex-shrink-0 ml-4">
                      <div className={`text-2xl font-bold ${getScoreColor(match.similarity)}`}>
                        {getScorePercent(match.similarity)}%
                      </div>
                      <div className="text-xs text-muted-foreground">match</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-4">
                    {match.tech_stack?.map((tech, j) => (
                      <span key={j} className="px-2 py-1 text-xs rounded-lg bg-muted text-muted-foreground">{tech}</span>
                    ))}
                  </div>

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3 h-3" />
                      {match.tasks?.length || 0} tasks
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {match.tasks?.reduce((a, t) => a + (t.estimated_hours || 0), 0)}h estimated
                    </span>
                    {match.usage_count > 0 && (
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        Used {match.usage_count}x
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => handleSelectTemplate(match)}
                    disabled={generating}
                    className={`w-full py-3 rounded-xl font-medium transition-all flex items-center justify-center gap-2 ${
                      match.similarity >= 0.75
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        : 'bg-muted hover:bg-muted text-white'
                    }`}
                    data-testid={`use-template-${i}`}
                  >
                    <Zap className="w-4 h-4" />
                    Use This Template
                  </button>
                </div>
              ))}
            </div>

            {/* Generate Custom button */}
            <div className="flex gap-3">
              <button
                onClick={handleGenerateCustom}
                disabled={generating}
                className="flex-1 py-4 rounded-2xl border border-border bg-[var(--t-surface-raised)] hover:bg-signal-soft hover:border-signal/30 text-white font-medium transition-all flex items-center justify-center gap-2"
                data-testid="generate-custom-btn"
              >
                <Sparkles className="w-4 h-4 text-signal" />
                Generate Custom Scope
              </button>
              <button
                onClick={() => handleSubmit()}
                disabled={loading}
                className="flex-1 py-4 rounded-2xl border border-border bg-muted hover:bg-muted text-muted-foreground font-medium transition-all flex items-center justify-center gap-2"
                data-testid="skip-templates-btn"
              >
                Skip & Submit Idea
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ============ STEP 3: GENERATED SCOPE ============ */}
        {step === 'scope' && (
          <div data-testid="generated-scope-step">
            <div className="mb-10">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-signal/10 border border-signal/20 backdrop-blur-sm mb-6">
                <Brain className="w-4 h-4 text-signal" />
                <span className="text-xs text-signal font-medium tracking-wide uppercase">
                  {generating ? 'Generating...' : 'AI-Generated Scope'}
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
                {generating ? 'Building your scope...' : 'Project Scope Ready'}
              </h1>
              {generatedScope?.template_name && (
                <p className="text-sm text-emerald-400">Based on template: {generatedScope.template_name}</p>
              )}
            </div>

            {generating ? (
              <div className="flex flex-col items-center justify-center py-20 gap-4">
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-2 border-signal/30 border-t-signal animate-spin" />
                  <Brain className="w-6 h-6 text-signal absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                </div>
                <p className="text-muted-foreground">AI is analyzing your idea and creating a detailed scope...</p>
              </div>
            ) : generatedScope?.scope ? (
              <>
                <div className="space-y-4 mb-8">
                  {/* Scope header */}
                  <div className="rounded-2xl border border-signal/20 bg-signal/5 p-6">
                    <h2 className="text-xl font-semibold mb-2">{generatedScope.scope.name || 'Project Scope'}</h2>
                    <p className="text-muted-foreground">{generatedScope.scope.description}</p>
                    
                    <div className="flex gap-6 mt-4 pt-4 border-t border-border">
                      {generatedScope.scope.estimated_hours && (
                        <div className="flex items-center gap-2 text-sm">
                          <Clock className="w-4 h-4 text-signal" />
                          <span className="text-muted-foreground">{generatedScope.scope.estimated_hours}h estimated</span>
                        </div>
                      )}
                      {generatedScope.scope.estimated_cost_usd && (
                        <div className="flex items-center gap-2 text-sm">
                          <DollarSign className="w-4 h-4 text-emerald-400" />
                          <span className="text-muted-foreground">${generatedScope.scope.estimated_cost_usd}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Tasks */}
                  <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] p-6">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-signal" />
                      Tasks ({generatedScope.scope.tasks?.length || 0})
                    </h3>
                    <div className="space-y-3">
                      {generatedScope.scope.tasks?.map((task, i) => (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-black/30 border border-border">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-1 flex-shrink-0" />
                          <div className="flex-1">
                            <div className="font-medium text-sm">{task.title}</div>
                            {task.description && <p className="text-xs text-muted-foreground mt-1">{task.description}</p>}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-xs text-muted-foreground">{task.estimated_hours}h</span>
                            {task.priority === 'high' && <span className="block text-xs text-amber-400">High</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Tech Stack */}
                  {generatedScope.scope.tech_stack?.length > 0 && (
                    <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] p-6">
                      <h3 className="font-semibold mb-3 text-sm">Tech Stack</h3>
                      <div className="flex flex-wrap gap-2">
                        {generatedScope.scope.tech_stack.map((tech, i) => (
                          <span key={i} className="px-3 py-1.5 text-xs rounded-xl bg-signal/10 text-signal border border-signal/20">{tech}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Submit buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="flex-1 bg-signal hover:bg-signal text-white py-4 rounded-2xl font-semibold flex items-center justify-center gap-3 transition-all shadow-lg shadow-signal/25 disabled:opacity-50"
                    data-testid="submit-with-scope-btn"
                  >
                    {loading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        Submit Project
                        <ArrowRight className="w-5 h-5" />
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => { setStep('matches'); setGeneratedScope(null); }}
                    className="px-6 py-4 rounded-2xl border border-border text-muted-foreground hover:text-white hover:border-border transition-all"
                    data-testid="back-to-templates-btn"
                  >
                    Back
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-12">
                <XCircle className="w-12 h-12 text-red-400/50 mx-auto mb-4" />
                <p className="text-muted-foreground mb-6">Scope generation unavailable. You can still submit your idea directly.</p>
                <button
                  onClick={handleSubmit}
                  disabled={loading}
                  className="bg-signal hover:bg-signal text-white px-8 py-4 rounded-2xl font-semibold transition-all"
                  data-testid="submit-direct-btn"
                >
                  {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Submit Idea Directly'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* What Happens Next - show only on idea step */}
        {step === 'idea' && (
          <div className="mt-16 rounded-2xl border border-border bg-[var(--t-surface-raised)] p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <ArrowRight className="w-4 h-4 text-signal" />
              What Happens Next
            </h3>
            <div className="space-y-4">
              <Step number="1" title="AI Matching" description="We find similar past projects to accelerate your build" />
              <Step number="2" title="Scope Generation" description="AI creates a detailed project scope with tasks and timeline" />
              <Step number="3" title="Review & Build" description="Our team reviews, refines, and starts development" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Step = ({ number, title, description }) => (
  <div className="flex items-start gap-4">
    <div className="w-8 h-8 rounded-lg bg-signal/10 border border-signal/20 flex items-center justify-center flex-shrink-0">
      <span className="text-sm font-bold text-signal">{number}</span>
    </div>
    <div>
      <h4 className="font-medium">{title}</h4>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  </div>
);

export default NewRequest;
