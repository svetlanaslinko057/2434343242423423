import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  ArrowLeft,
  Package,
  Plus,
  Trash2,
  Check,
  Link,
  Code,
  FileText,
  Layers,
  Send,
  Loader2,
  ExternalLink,
  GripVertical
} from 'lucide-react';

const AdminDeliverableBuilder = () => {
  const { projectId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [completedUnits, setCompletedUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Deliverable form state
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [version, setVersion] = useState('v1.0');
  const [blocks, setBlocks] = useState([]);
  const [resources, setResources] = useState([]);
  const [selectedUnits, setSelectedUnits] = useState([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [projectsRes, unitsRes] = await Promise.all([
          axios.get(`${API}/admin/projects`, { withCredentials: true }),
          axios.get(`${API}/admin/projects/${projectId}/completed-units`, { withCredentials: true })
        ]);

        const proj = projectsRes.data.find(p => p.project_id === projectId);
        setProject(proj);
        setCompletedUnits(unitsRes.data);
        
        if (proj) {
          setTitle(`${proj.name} — Delivery`);
        }
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [projectId]);

  const toggleUnitSelection = (unitId) => {
    setSelectedUnits(prev => 
      prev.includes(unitId) 
        ? prev.filter(id => id !== unitId)
        : [...prev, unitId]
    );
  };

  const addBlock = () => {
    setBlocks([...blocks, {
      id: Date.now(),
      block_type: 'feature',
      title: '',
      description: '',
      preview_url: '',
      api_url: '',
      work_unit_ids: []
    }]);
  };

  const updateBlock = (index, field, value) => {
    const newBlocks = [...blocks];
    newBlocks[index][field] = value;
    setBlocks(newBlocks);
  };

  const removeBlock = (index) => {
    setBlocks(blocks.filter((_, i) => i !== index));
  };

  const addResource = () => {
    setResources([...resources, {
      id: Date.now(),
      resource_type: 'repo',
      title: '',
      url: ''
    }]);
  };

  const updateResource = (index, field, value) => {
    const newResources = [...resources];
    newResources[index][field] = value;
    setResources(newResources);
  };

  const removeResource = (index) => {
    setResources(resources.filter((_, i) => i !== index));
  };

  const createFromSelected = () => {
    // Group selected units into a block
    const selectedUnitObjects = completedUnits.filter(u => selectedUnits.includes(u.unit_id));
    if (selectedUnitObjects.length === 0) return;

    // Group by type
    const grouped = {};
    selectedUnitObjects.forEach(unit => {
      const type = unit.unit_type || 'feature';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(unit);
    });

    // Create blocks from groups
    const newBlocks = Object.entries(grouped).map(([type, units]) => ({
      id: Date.now() + Math.random(),
      block_type: type === 'task' ? 'feature' : type,
      title: units.length === 1 ? units[0].title : `${type.charAt(0).toUpperCase() + type.slice(1)} Package`,
      description: units.map(u => u.title).join(', '),
      preview_url: '',
      api_url: '',
      work_unit_ids: units.map(u => u.unit_id)
    }));

    setBlocks([...blocks, ...newBlocks]);
    setSelectedUnits([]);
  };

  const handleSubmit = async () => {
    if (!title.trim() || !summary.trim() || blocks.length === 0) {
      alert('Please fill title, summary and add at least one block');
      return;
    }

    setSubmitting(true);
    try {
      await axios.post(`${API}/admin/deliverable?project_id=${projectId}`, {
        title,
        summary,
        version,
        blocks: blocks.map(b => ({
          block_type: b.block_type,
          title: b.title,
          description: b.description,
          preview_url: b.preview_url || null,
          api_url: b.api_url || null,
          work_unit_ids: b.work_unit_ids
        })),
        resources: resources.map(r => ({
          resource_type: r.resource_type,
          title: r.title,
          url: r.url
        }))
      }, { withCredentials: true });

      alert('Deliverable created and sent to client!');
      navigate('/admin/dashboard');
    } catch (error) {
      console.error('Error creating deliverable:', error);
      alert('Failed to create deliverable');
    } finally {
      setSubmitting(false);
    }
  };

  const blockTypes = [
    { value: 'feature', label: 'Feature', icon: Layers },
    { value: 'integration', label: 'Integration', icon: Link },
    { value: 'api', label: 'API', icon: Code },
    { value: 'design', label: 'Design', icon: FileText }
  ];

  const resourceTypes = [
    { value: 'repo', label: 'Repository' },
    { value: 'api', label: 'API Docs' },
    { value: 'demo', label: 'Live Demo' },
    { value: 'figma', label: 'Figma' },
    { value: 'documentation', label: 'Documentation' }
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--t-bg)] text-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white" data-testid="deliverable-builder">
      {/* Header */}
      <header className="border-b border-border bg-black/60 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <button 
            onClick={() => navigate('/admin/dashboard')}
            className="flex items-center gap-2 text-muted-foreground hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-3">
            <Package className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold">Deliverable Builder</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="grid grid-cols-3 gap-8">
          {/* Left: Work Units Selection */}
          <div className="col-span-1">
            <div className="border border-border rounded-2xl p-5 sticky top-24">
              <h2 className="text-lg font-semibold mb-4">Completed Work Units</h2>
              <p className="text-muted-foreground text-sm mb-4">Select units to include in deliverable</p>

              {completedUnits.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No completed units yet</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {completedUnits.map(unit => (
                    <button
                      key={unit.unit_id}
                      onClick={() => toggleUnitSelection(unit.unit_id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${
                        selectedUnits.includes(unit.unit_id)
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-border hover:border-border'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-5 h-5 rounded-lg border-2 flex items-center justify-center ${
                          selectedUnits.includes(unit.unit_id)
                            ? 'border-emerald-500 bg-emerald-500'
                            : 'border-border'
                        }`}>
                          {selectedUnits.includes(unit.unit_id) && (
                            <Check className="w-3 h-3 text-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{unit.title}</div>
                          <div className="text-muted-foreground text-xs capitalize">{unit.unit_type}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {selectedUnits.length > 0 && (
                <button
                  onClick={createFromSelected}
                  className="w-full mt-4 bg-muted text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-muted transition-all flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create Block from {selectedUnits.length} units
                </button>
              )}
            </div>
          </div>

          {/* Right: Deliverable Form */}
          <div className="col-span-2 space-y-6">
            {/* Basic Info */}
            <div className="border border-border rounded-2xl p-6">
              <h2 className="text-lg font-semibold mb-4">Deliverable Info</h2>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Title *</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Marketplace v1 — Delivery"
                    className="w-full bg-muted border border-border rounded-xl p-3 text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm text-muted-foreground mb-2">Version</label>
                  <input
                    type="text"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="v1.0"
                    className="w-full bg-muted border border-border rounded-xl p-3 text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm text-muted-foreground mb-2">Summary *</label>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  placeholder="First working version of your product is ready. Here's what's included..."
                  className="w-full bg-muted border border-border rounded-xl p-3 text-white h-24 resize-none"
                />
              </div>
            </div>

            {/* Blocks */}
            <div className="border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Feature Blocks</h2>
                <button
                  onClick={addBlock}
                  className="bg-muted text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-muted transition-all flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Block
                </button>
              </div>

              {blocks.length === 0 ? (
                <div className="border border-border border-dashed rounded-xl p-8 text-center text-muted-foreground">
                  <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No blocks yet. Add blocks to describe delivered features.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {blocks.map((block, index) => (
                    <div key={block.id} className="border border-border rounded-xl p-4 bg-white/[0.02]">
                      <div className="flex items-start gap-3">
                        <div className="text-muted-foreground cursor-move">
                          <GripVertical className="w-5 h-5" />
                        </div>
                        
                        <div className="flex-1 space-y-3">
                          <div className="grid grid-cols-3 gap-3">
                            <select
                              value={block.block_type}
                              onChange={(e) => updateBlock(index, 'block_type', e.target.value)}
                              className="bg-muted border border-border rounded-xl p-2 text-white text-sm"
                            >
                              {blockTypes.map(type => (
                                <option key={type.value} value={type.value}>{type.label}</option>
                              ))}
                            </select>
                            <input
                              type="text"
                              value={block.title}
                              onChange={(e) => updateBlock(index, 'title', e.target.value)}
                              placeholder="Feature title"
                              className="col-span-2 bg-muted border border-border rounded-xl p-2 text-white text-sm"
                            />
                          </div>
                          
                          <textarea
                            value={block.description}
                            onChange={(e) => updateBlock(index, 'description', e.target.value)}
                            placeholder="What this feature does..."
                            className="w-full bg-muted border border-border rounded-xl p-2 text-white text-sm h-16 resize-none"
                          />
                          
                          <div className="grid grid-cols-2 gap-3">
                            <input
                              type="url"
                              value={block.preview_url}
                              onChange={(e) => updateBlock(index, 'preview_url', e.target.value)}
                              placeholder="Preview URL (optional)"
                              className="bg-muted border border-border rounded-xl p-2 text-white text-sm"
                            />
                            <input
                              type="url"
                              value={block.api_url}
                              onChange={(e) => updateBlock(index, 'api_url', e.target.value)}
                              placeholder="API URL (optional)"
                              className="bg-muted border border-border rounded-xl p-2 text-white text-sm"
                            />
                          </div>

                          {block.work_unit_ids.length > 0 && (
                            <div className="text-xs text-muted-foreground">
                              Linked units: {block.work_unit_ids.length}
                            </div>
                          )}
                        </div>

                        <button
                          onClick={() => removeBlock(index)}
                          className="text-muted-foreground hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Resources */}
            <div className="border border-border rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Resources</h2>
                <button
                  onClick={addResource}
                  className="bg-muted text-white rounded-xl px-4 py-2 text-sm font-medium hover:bg-muted transition-all flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Resource
                </button>
              </div>

              {resources.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  Add links to repos, docs, demos
                </div>
              ) : (
                <div className="space-y-3">
                  {resources.map((resource, index) => (
                    <div key={resource.id} className="flex items-center gap-3">
                      <select
                        value={resource.resource_type}
                        onChange={(e) => updateResource(index, 'resource_type', e.target.value)}
                        className="bg-muted border border-border rounded-xl p-2 text-white text-sm"
                      >
                        {resourceTypes.map(type => (
                          <option key={type.value} value={type.value}>{type.label}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={resource.title}
                        onChange={(e) => updateResource(index, 'title', e.target.value)}
                        placeholder="Resource title"
                        className="flex-1 bg-muted border border-border rounded-xl p-2 text-white text-sm"
                      />
                      <input
                        type="url"
                        value={resource.url}
                        onChange={(e) => updateResource(index, 'url', e.target.value)}
                        placeholder="https://..."
                        className="flex-1 bg-muted border border-border rounded-xl p-2 text-white text-sm"
                      />
                      <button
                        onClick={() => removeResource(index)}
                        className="text-muted-foreground hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={submitting || !title.trim() || !summary.trim() || blocks.length === 0}
              className="w-full bg-emerald-500 text-white rounded-2xl p-4 font-semibold flex items-center justify-center gap-2 hover:bg-emerald-600 disabled:opacity-50 transition-all"
              data-testid="send-deliverable-btn"
            >
              {submitting ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Send Deliverable to Client
                </>
              )}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminDeliverableBuilder;
