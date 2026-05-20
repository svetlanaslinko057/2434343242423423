import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { ArrowLeft, ArrowRight, Loader2, Code, Server, Layers, Paintbrush, TestTube } from 'lucide-react';

const SKILL_OPTIONS = [
  { id: 'frontend', label: 'Frontend Developer', icon: Code, role: 'developer' },
  { id: 'backend', label: 'Backend Developer', icon: Server, role: 'developer' },
  { id: 'fullstack', label: 'Fullstack Developer', icon: Layers, role: 'developer' },
  { id: 'designer', label: 'Designer', icon: Paintbrush, role: 'developer' },
  { id: 'tester', label: 'Tester / QA', icon: TestTube, role: 'tester' },
];

const BuilderAuth = () => {
  const [step, setStep] = useState('skill'); // skill, email, onboarding
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { setUser } = useAuth();
  const navigate = useNavigate();

  const handleSkillSelect = (skill) => {
    setSelectedSkill(skill);
    setStep('email');
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    
    setLoading(true);
    setError('');
    
    try {
      const res = await runtime.post(`/api/auth/quick`, {
        email: email.trim(),
        role: selectedSkill.role,
        skill: selectedSkill.id
      });
      
      if (res.data.isNew) {
        setStep('onboarding');
      } else {
        setUser(res.data.user);
        const route = res.data.user.role === 'tester' ? '/tester/hub' : '/developer/hub';
        navigate(route);
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleOnboardingSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setLoading(true);
    
    try {
      const res = await runtime.post(`/api/auth/onboarding`, {
        email: email.trim(),
        name: name.trim(),
        role: selectedSkill.role,
        skills: [selectedSkill.id]
      });
      
      setUser(res.data);
      const route = res.data.role === 'tester' ? '/tester/hub' : '/developer/hub';
      navigate(route);
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    if (step === 'skill') navigate('/');
    else if (step === 'email') setStep('skill');
    else if (step === 'onboarding') setStep('email');
  };

  return (
    <div 
      className="min-h-screen bg-[var(--t-bg)] text-white flex items-center justify-center px-6"
      style={{ fontFamily: "'Cabinet Grotesk', 'Inter', sans-serif" }}
    >
      <div className="w-full max-w-md">
        {/* Back button */}
        <button 
          onClick={goBack}
          className="flex items-center gap-2 text-muted-foreground hover:text-white mb-8 transition-colors"
          data-testid="back-btn"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {/* Step 1: Skill Selection */}
        {step === 'skill' && (
          <div>
            <h1 className="text-3xl font-bold mb-2">What do you do?</h1>
            <p className="text-muted-foreground mb-8">Select your primary skill</p>

            <div className="space-y-3">
              {SKILL_OPTIONS.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => handleSkillSelect(skill)}
                  className="w-full flex items-center gap-4 p-4 border border-border hover:border-border hover:bg-muted transition-all group"
                  data-testid={`skill-${skill.id}`}
                >
                  <skill.icon className="w-5 h-5 text-muted-foreground group-hover:text-white transition-colors" strokeWidth={1.5} />
                  <span className="flex-1 text-left">{skill.label}</span>
                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: Email */}
        {step === 'email' && (
          <form onSubmit={handleEmailSubmit}>
            <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
              {selectedSkill && <selectedSkill.icon className="w-5 h-5 text-muted-foreground" strokeWidth={1.5} />}
              <span className="text-muted-foreground">{selectedSkill?.label}</span>
            </div>

            <h1 className="text-3xl font-bold mb-2">Join platform</h1>
            <p className="text-muted-foreground mb-8">Enter your email to continue</p>

            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-muted border border-border p-4 text-white placeholder:text-muted-foreground focus:outline-none focus:border-border transition-colors"
              data-testid="email-input"
              autoFocus
            />

            {error && (
              <div className="mt-3 text-red-400 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full mt-4 bg-white text-[var(--t-bg)] p-4 font-medium flex items-center justify-center gap-2 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              data-testid="continue-btn"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}

        {/* Step 3: Onboarding */}
        {step === 'onboarding' && (
          <form onSubmit={handleOnboardingSubmit}>
            <h1 className="text-3xl font-bold mb-2">Almost there</h1>
            <p className="text-muted-foreground mb-8">Tell us your name</p>

            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-muted border border-border p-4 text-white placeholder:text-muted-foreground focus:outline-none focus:border-border transition-colors"
              data-testid="name-input"
              autoFocus
            />

            {error && (
              <div className="mt-3 text-red-400 text-sm">{error}</div>
            )}

            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="w-full mt-4 bg-white text-[var(--t-bg)] p-4 font-medium flex items-center justify-center gap-2 hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              data-testid="complete-btn"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  Complete Setup
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default BuilderAuth;
