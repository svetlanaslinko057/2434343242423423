import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  ArrowLeft,
  Plus,
  Loader2,
  Package,
  Link,
  CheckCircle2,
  XCircle,
  FileText
} from 'lucide-react';

const DeliverableBuilder = () => {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  
  const [project, setProject] = useState(null);
  const [completedUnits, setCompletedUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const [deliverable, setDeliverable] = useState({
    title: '',
    description: '',
    links: [''],
    selected_units: []
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get project
        const projectsRes = await axios.get(`${API}/admin/projects`, { withCredentials: true });
        const foundProject = projectsRes.data.find(p => p.project_id === projectId);
        setProject(foundProject);
        
        // Get completed work units for this project
        const unitsRes = await axios.get(`${API}/admin/work-units`, { withCredentials: true });
        const completed = unitsRes.data.filter(u => 
          u.project_id === projectId && 
          ['completed', 'validation'].includes(u.status)
        );
        setCompletedUnits(completed);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [projectId]);

  const addLink = () => {
    setDeliverable({
      ...deliverable,
      links: [...deliverable.links, '']
    });
  };

  const updateLink = (index, value) => {
    const updated = [...deliverable.links];
    updated[index] = value;
    setDeliverable({ ...deliverable, links: updated });
  };

  const removeLink = (index) => {
    const updated = deliverable.links.filter((_, i) => i !== index);
    setDeliverable({ ...deliverable, links: updated });
  };

  const toggleUnit = (unitId) => {
    const selected = deliverable.selected_units.includes(unitId)
      ? deliverable.selected_units.filter(id => id !== unitId)
      : [...deliverable.selected_units, unitId];
    setDeliverable({ ...deliverable, selected_units: selected });
  };

  const handleSubmit = async () => {
    if (!deliverable.title.trim()) {
      alert('Please enter a title');
      return;
    }
    
    setSubmitting(true);
    try {
      await axios.post(`${API}/admin/deliverable`, {
        project_id: projectId,
        title: deliverable.title,
        description: deliverable.description,
        links: deliverable.links.filter(l => l.trim()),
        work_unit_ids: deliverable.selected_units
      }, { withCredentials: true });
      
      navigate(`/admin/work-board`);
    } catch (error) {
      console.error('Error creating deliverable:', error);
      alert('Failed to create deliverable');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--t-bg)] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen bg-[var(--t-bg)] text-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Project not found</p>
          <button onClick={() => navigate('/admin/work-board')} className="text-white underline">
            Back to Admin
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white" data-testid="deliverable-builder">
      {/* Header */}
      <header className="border-b border-border bg-black/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <button 
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <span className="text-lg font-bold tracking-tight">Create Deliverable</span>
          <div className="w-16" />
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="space-y-8">
          {/* Project Info */}
          <div className="border border-border p-5 bg-white/[0.02]">
            <div className="text-muted-foreground text-sm mb-1">Project</div>
            <div className="font-semibold text-lg">{project.name}</div>
          </div>

          {/* Deliverable Form */}
          <div className="space-y-6">
            <div>
              <label className="block text-sm text-muted-foreground mb-2">Title *</label>
              <input
                value={deliverable.title}
                onChange={(e) => setDeliverable({ ...deliverable, title: e.target.value })}
                placeholder="e.g., Authentication Module, Dashboard UI"
                className="w-full bg-muted border border-border p-3 text-white"
              />
            </div>

            <div>
              <label className="block text-sm text-muted-foreground mb-2">Description</label>
              <textarea
                value={deliverable.description}
                onChange={(e) => setDeliverable({ ...deliverable, description: e.target.value })}
                placeholder="Describe what's included in this deliverable..."
                className="w-full bg-muted border border-border p-3 text-white h-24 resize-none"
              />
            </div>

            {/* Links */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm text-muted-foreground">Links</label>
                <button
                  onClick={addLink}
                  className="text-muted-foreground hover:text-white text-sm flex items-center gap-1"
                >
                  <Plus className="w-4 h-4" />
                  Add Link
                </button>
              </div>
              <div className="space-y-2">
                {deliverable.links.map((link, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Link className="w-4 h-4 text-muted-foreground" />
                    <input
                      value={link}
                      onChange={(e) => updateLink(index, e.target.value)}
                      placeholder="https://..."
                      className="flex-1 bg-muted border border-border p-2 text-white text-sm"
                    />
                    {deliverable.links.length > 1 && (
                      <button
                        onClick={() => removeLink(index)}
                        className="text-muted-foreground hover:text-red-400"
                      >
                        <XCircle className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Work Units */}
            <div>
              <label className="block text-sm text-muted-foreground mb-2">
                Included Work Units ({deliverable.selected_units.length} selected)
              </label>
              
              {completedUnits.length === 0 ? (
                <div className="border border-border border-dashed p-6 text-center">
                  <Package className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-muted-foreground text-sm">No completed work units available</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {completedUnits.map((unit) => (
                    <button
                      key={unit.unit_id}
                      onClick={() => toggleUnit(unit.unit_id)}
                      className={`w-full text-left p-3 border transition-all ${
                        deliverable.selected_units.includes(unit.unit_id)
                          ? 'border-emerald-500/50 bg-emerald-500/10'
                          : 'border-border hover:border-border'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {deliverable.selected_units.includes(unit.unit_id) ? (
                            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                          ) : (
                            <div className="w-5 h-5 border border-border rounded-full" />
                          )}
                          <div>
                            <div className="font-medium">{unit.title}</div>
                            <div className="text-muted-foreground text-xs">{unit.estimated_hours}h estimated</div>
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 text-xs border ${
                          unit.status === 'completed' 
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-orange-500/10 text-orange-400 border-orange-500/20'
                        }`}>
                          {unit.status}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-4 pt-4 border-t border-border">
            <button
              onClick={() => navigate(-1)}
              className="px-6 py-3 border border-border hover:bg-muted transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={submitting || !deliverable.title.trim()}
              className="bg-white text-black px-6 py-3 font-medium flex items-center gap-2 hover:bg-muted disabled:opacity-50 transition-all"
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Package className="w-5 h-5" />
                  Create Deliverable
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DeliverableBuilder;
