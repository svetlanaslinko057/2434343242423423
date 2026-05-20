import { useState, useEffect } from 'react';
import { useAuth } from '@/App';
import axios from 'axios';
import { Monitor, Send, XCircle, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

/**
 * DEVELOPER WORKSPACE
 * Execution loop: submit deliverable, drop module
 */

const API = process.env.REACT_APP_BACKEND_URL ? `${process.env.REACT_APP_BACKEND_URL}/api` : '/api';

const DeveloperWorkspace = () => {
  const { user } = useAuth();
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitDialog, setSubmitDialog] = useState({ open: false, module: null });
  const [dropDialog, setDropDialog] = useState({ open: false, module: null });
  const [deliverableUrl, setDeliverableUrl] = useState('');
  const [deliverableNotes, setDeliverableNotes] = useState('');
  const [dropReason, setDropReason] = useState('');

  const fetchModules = async () => {
    try {
      const res = await axios.get(`${API}/developer/marketplace/my-modules`, { withCredentials: true });
      setModules(res.data.modules || []);
    } catch (error) {
      console.error('Failed to fetch modules:', error);
      toast.error('Failed to load workspace');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModules();
  }, []);

  const handleSubmit = async () => {
    if (!deliverableUrl.trim()) {
      toast.error('Please provide a deliverable URL');
      return;
    }

    try {
      await axios.post(
        `${API}/modules/${submitDialog.module.module_id}/submit`,
        {
          deliverable_url: deliverableUrl,
          notes: deliverableNotes
        },
        { withCredentials: true }
      );

      toast.success('Deliverable submitted for QA review!');
      setSubmitDialog({ open: false, module: null });
      setDeliverableUrl('');
      setDeliverableNotes('');
      fetchModules();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to submit');
    }
  };

  const handleDrop = async () => {
    if (!dropReason.trim()) {
      toast.error('Please provide a reason for dropping');
      return;
    }

    try {
      await axios.post(
        `${API}/marketplace/modules/${dropDialog.module.module_id}/release`,
        { reason: dropReason },
        { withCredentials: true }
      );

      toast.success('Module released');
      setDropDialog({ open: false, module: null });
      setDropReason('');
      fetchModules();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to drop module');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading workspace...</p>
      </div>
    );
  }

  const activeModules = modules.filter(m => m.status === 'in_progress' || m.status === 'reserved');
  const reviewModules = modules.filter(m => m.status === 'review' || m.status === 'qa_review');

  return (
    <div className="min-h-screen bg-background text-foreground p-6" data-testid="developer-workspace">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <Monitor className="w-8 h-8" />
            Workspace
          </h1>
          <p className="text-muted-foreground mt-1">Manage your active modules and deliverables</p>
        </div>

        {/* Active Modules */}
        <div>
          <h2 className="text-xl font-bold text-foreground mb-4">Active Modules ({activeModules.length})</h2>
          
          {activeModules.length === 0 ? (
            <Card className="bg-card border border-dashed border-border p-12 text-center">
              <Monitor className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground mb-4">No active modules</p>
              <Button
                onClick={() => { const base = process.env.PUBLIC_URL || '/api/web-ui'; window.location.href = `${base}/developer/marketplace`; }}
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                Browse Marketplace
              </Button>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {activeModules.map((module) => (
                <Card 
                  key={module.module_id}
                  className="bg-card border-l-4 border-l-[color:var(--info)] border-t border-r border-b border-border shadow-[var(--shadow-elev-1)]"
                  data-testid={`workspace-module-${module.module_id}`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h3 className="text-xl font-semibold text-foreground">{module.title}</h3>
                          <Badge className={`
                            ${module.status === 'in_progress' ? 'bg-[color:var(--info-surface)] border-[color:var(--info-border)] text-[color:var(--info)]' : ''}
                            ${module.status === 'reserved' ? 'bg-[color:var(--neutral-surface)] border-[color:var(--neutral-border)] text-muted-foreground' : ''}
                          `}>
                            {module.status === 'in_progress' ? 'In Progress' : 'Reserved'}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{module.project_name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold font-mono text-[color:var(--success)]">${module.price}</p>
                        <p className="text-sm text-muted-foreground">{module.estimated_hours}h est</p>
                      </div>
                    </div>

                    {/* Scope */}
                    {module.scope && module.scope.length > 0 && (
                      <div className="mb-4 p-3 bg-muted rounded-lg border border-border">
                        <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Deliverables:</p>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          {module.scope.map((item, idx) => (
                            <li key={idx} className="flex items-start gap-2">
                              <CheckCircle2 className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                              {item}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-3">
                      <Button
                        onClick={() => setSubmitDialog({ open: true, module })}
                        className="flex-1 bg-[color:var(--success)] text-foreground hover:bg-[color:var(--success)]/90"
                        data-testid={`submit-module-${module.module_id}`}
                      >
                        <Send className="w-4 h-4 mr-2" />
                        Submit Deliverable
                      </Button>
                      <Button
                        onClick={() => setDropDialog({ open: true, module })}
                        variant="outline"
                        className="border-[color:var(--danger-border)] text-[color:var(--danger)] hover:bg-[color:var(--danger-surface)]"
                        data-testid={`drop-module-${module.module_id}`}
                      >
                        <XCircle className="w-4 h-4 mr-2" />
                        Drop Module
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Modules in Review */}
        {reviewModules.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-4">In QA Review ({reviewModules.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reviewModules.map((module) => (
                <Card 
                  key={module.module_id}
                  className="bg-card border-l-4 border-l-[color:var(--warning)] border-t border-r border-b border-border shadow-[var(--shadow-elev-1)]"
                  data-testid={`review-module-${module.module_id}`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-foreground">{module.title}</h3>
                        <p className="text-sm text-muted-foreground">{module.project_name}</p>
                      </div>
                      <Badge className="bg-[color:var(--warning-surface)] border-[color:var(--warning-border)] text-[color:var(--warning)]">
                        QA Review
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-4 h-4" />
                      <span>Awaiting QA decision</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Submit Dialog */}
        <Dialog open={submitDialog.open} onOpenChange={(open) => setSubmitDialog({ open, module: null })}>
          <DialogContent className="bg-card border border-border text-foreground">
            <DialogHeader>
              <DialogTitle className="text-foreground">Submit Deliverable</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {submitDialog.module?.title}
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div>
                <Label htmlFor="deliverable-url" className="text-foreground">Deliverable URL *</Label>
                <Input
                  id="deliverable-url"
                  placeholder="https://github.com/..."
                  value={deliverableUrl}
                  onChange={(e) => setDeliverableUrl(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  data-testid="deliverable-url-input"
                />
              </div>
              <div>
                <Label htmlFor="deliverable-notes" className="text-foreground">Notes (optional)</Label>
                <Textarea
                  id="deliverable-notes"
                  placeholder="Additional notes for QA..."
                  value={deliverableNotes}
                  onChange={(e) => setDeliverableNotes(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  rows={3}
                  data-testid="deliverable-notes-input"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setSubmitDialog({ open: false, module: null })}
                className="border-border text-foreground hover:bg-muted"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                className="bg-[color:var(--success)] text-foreground hover:bg-[color:var(--success)]/90"
                data-testid="submit-confirm-btn"
              >
                <Send className="w-4 h-4 mr-2" />
                Submit to QA
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Drop Dialog */}
        <Dialog open={dropDialog.open} onOpenChange={(open) => setDropDialog({ open, module: null })}>
          <DialogContent className="bg-card border border-border text-foreground">
            <DialogHeader>
              <DialogTitle className="text-[color:var(--danger)]">Drop Module</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                {dropDialog.module?.title}
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div className="p-3 bg-[color:var(--warning-surface)] border border-[color:var(--warning-border)] rounded-lg flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-[color:var(--warning)] flex-shrink-0 mt-0.5" />
                <p className="text-sm text-[color:var(--warning)]">
                  Dropping a module may affect your rating. Make sure you have a valid reason.
                </p>
              </div>
              <div>
                <Label htmlFor="drop-reason" className="text-foreground">Reason *</Label>
                <Textarea
                  id="drop-reason"
                  placeholder="Why are you dropping this module?"
                  value={dropReason}
                  onChange={(e) => setDropReason(e.target.value)}
                  className="bg-muted border-border text-foreground placeholder:text-muted-foreground"
                  rows={3}
                  data-testid="drop-reason-input"
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDropDialog({ open: false, module: null })}
                className="border-border text-foreground hover:bg-muted"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDrop}
                className="bg-[color:var(--danger)] text-foreground hover:bg-[color:var(--danger)]/90"
                data-testid="drop-confirm-btn"
              >
                <XCircle className="w-4 h-4 mr-2" />
                Drop Module
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default DeveloperWorkspace;
