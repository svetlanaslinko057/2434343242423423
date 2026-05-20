import { useState, useEffect } from 'react';
import { useAuth, API } from '@/App';
import axios from 'axios';
import { Brain, Plus, Trash2, Loader2, FileText, Clock, Zap, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';

const AdminTemplatesPage = () => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [form, setForm] = useState({
    name: '', description: '', category: 'other', tech_stack: '', tasks: [{ title: '', estimated_hours: 0, priority: 'normal' }]
  });

  const fetchTemplates = async () => {
    try {
      const res = await axios.get(`${API}/ai/templates`, { withCredentials: true });
      setTemplates(res.data);
    } catch (err) {
      console.error('Error fetching templates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTemplates(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      await axios.post(`${API}/ai/templates`, {
        name: form.name,
        description: form.description,
        category: form.category,
        tech_stack: form.tech_stack.split(',').map(s => s.trim()).filter(Boolean),
        tasks: form.tasks.filter(t => t.title.trim())
      }, { withCredentials: true });
      setShowForm(false);
      setForm({ name: '', description: '', category: 'other', tech_stack: '', tasks: [{ title: '', estimated_hours: 0, priority: 'normal' }] });
      fetchTemplates();
    } catch (err) {
      console.error('Create error:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (templateId) => {
    if (!window.confirm('Delete this template?')) return;
    try {
      await axios.delete(`${API}/ai/templates/${templateId}`, { withCredentials: true });
      fetchTemplates();
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const addTask = () => {
    setForm(f => ({ ...f, tasks: [...f.tasks, { title: '', estimated_hours: 0, priority: 'normal' }] }));
  };

  const updateTask = (idx, field, value) => {
    setForm(f => {
      const tasks = [...f.tasks];
      tasks[idx] = { ...tasks[idx], [field]: value };
      return { ...f, tasks };
    });
  };

  const removeTask = (idx) => {
    setForm(f => ({ ...f, tasks: f.tasks.filter((_, i) => i !== idx) }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-signal" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6" data-testid="admin-templates-page">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Brain className="w-6 h-6 text-signal" />
          <div>
            <h1 className="text-2xl font-semibold">Scope Templates</h1>
            <p className="text-sm text-zinc-400">AI Template Matcher uses these to accelerate project scoping</p>
          </div>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-signal hover:bg-signal text-white rounded-xl text-sm font-medium flex items-center gap-2 transition-colors"
          data-testid="add-template-btn"
        >
          <Plus className="w-4 h-4" />
          Add Template
        </button>
      </div>

      {/* Create Form */}
      {showForm && (
        <form onSubmit={handleCreate} className="rounded-2xl border border-signal/50 bg-signal/5 p-6 space-y-4" data-testid="template-form">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Template Name</label>
              <input
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-signal"
                placeholder="E.g. Marketplace MVP"
                required
                data-testid="template-name-input"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Category</label>
              <select
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none"
                data-testid="template-category-select"
              >
                {['marketplace', 'saas', 'mobile', 'ecommerce', 'dashboard', 'api', 'other'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none min-h-[80px] resize-none"
              placeholder="Describe the template..."
              data-testid="template-description-input"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Tech Stack (comma-separated)</label>
            <input
              value={form.tech_stack}
              onChange={e => setForm(f => ({ ...f, tech_stack: e.target.value }))}
              className="w-full bg-black/50 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none"
              placeholder="React, Node.js, MongoDB"
              data-testid="template-tech-input"
            />
          </div>

          {/* Tasks */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-zinc-400">Tasks</label>
              <button type="button" onClick={addTask} className="text-xs text-signal hover:text-signal">+ Add Task</button>
            </div>
            <div className="space-y-2">
              {form.tasks.map((task, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={task.title}
                    onChange={e => updateTask(i, 'title', e.target.value)}
                    className="flex-1 bg-black/50 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none"
                    placeholder="Task title"
                  />
                  <input
                    type="number"
                    value={task.estimated_hours}
                    onChange={e => updateTask(i, 'estimated_hours', parseInt(e.target.value) || 0)}
                    className="w-20 bg-black/50 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:outline-none text-center"
                    placeholder="hrs"
                  />
                  <select
                    value={task.priority}
                    onChange={e => updateTask(i, 'priority', e.target.value)}
                    className="w-24 bg-black/50 border border-zinc-800 rounded-lg px-2 py-2 text-xs focus:outline-none"
                  >
                    <option value="high">High</option>
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                  </select>
                  {form.tasks.length > 1 && (
                    <button type="button" onClick={() => removeTask(i)} className="text-red-400 hover:text-red-300 p-2">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={creating || !form.name.trim()}
              className="px-6 py-2.5 bg-signal hover:bg-signal text-white rounded-xl text-sm font-medium disabled:opacity-50"
              data-testid="save-template-btn"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Template'}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-6 py-2.5 border border-zinc-800 rounded-xl text-sm text-zinc-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Templates list */}
      <div className="space-y-3">
        {templates.length === 0 ? (
          <div className="text-center py-16 text-zinc-500">
            <Brain className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No templates yet. Create one to power AI matching.</p>
          </div>
        ) : (
          templates.map((tmpl) => (
            <div key={tmpl.template_id} className="rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden" data-testid={`template-${tmpl.template_id}`}>
              <div
                className="flex items-center justify-between p-5 cursor-pointer hover:bg-zinc-900/50 transition-colors"
                onClick={() => setExpanded(expanded === tmpl.template_id ? null : tmpl.template_id)}
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-signal/10 flex items-center justify-center">
                    <Brain className="w-5 h-5 text-signal" />
                  </div>
                  <div>
                    <h3 className="font-semibold">{tmpl.name}</h3>
                    <div className="flex items-center gap-4 mt-1 text-xs text-zinc-500">
                      <span className="px-2 py-0.5 rounded bg-zinc-800">{tmpl.category}</span>
                      <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {tmpl.tasks?.length || 0} tasks</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {tmpl.tasks?.reduce((a, t) => a + (t.estimated_hours || 0), 0)}h</span>
                      <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Used {tmpl.usage_count}x</span>
                      {tmpl.success_rate > 0 && <span className="text-emerald-400">{Math.round(tmpl.success_rate * 100)}% success</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(tmpl.template_id); }}
                    className="p-2 text-zinc-500 hover:text-red-400 transition-colors"
                    data-testid={`delete-template-${tmpl.template_id}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  {expanded === tmpl.template_id ? <ChevronUp className="w-4 h-4 text-zinc-500" /> : <ChevronDown className="w-4 h-4 text-zinc-500" />}
                </div>
              </div>

              {expanded === tmpl.template_id && (
                <div className="px-5 pb-5 border-t border-zinc-800/50">
                  {tmpl.description && <p className="text-sm text-zinc-400 py-3">{tmpl.description}</p>}
                  {tmpl.tech_stack?.length > 0 && (
                    <div className="flex flex-wrap gap-2 mb-3">
                      {tmpl.tech_stack.map((t, i) => (
                        <span key={i} className="px-2 py-1 text-xs rounded-lg bg-signal/10 text-signal">{t}</span>
                      ))}
                    </div>
                  )}
                  <div className="space-y-2">
                    {tmpl.tasks?.map((task, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-black/30 border border-zinc-800/50">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400/50 flex-shrink-0" />
                        <span className="flex-1 text-sm">{task.title}</span>
                        <span className="text-xs text-zinc-500">{task.estimated_hours}h</span>
                        <span className={`text-xs px-2 py-0.5 rounded ${task.priority === 'high' ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-500'}`}>{task.priority}</span>
                      </div>
                    ))}
                  </div>
                  {tmpl.created_from_project && (
                    <div className="mt-3 text-xs text-zinc-500">Created from project: {tmpl.created_from_project}</div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AdminTemplatesPage;
