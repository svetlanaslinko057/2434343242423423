import { useState, useEffect } from 'react';
import { useAuth, API } from '@/App';
import axios from 'axios';
import { Clock, CheckCircle, XCircle, HelpCircle, AlertTriangle, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DECLINE_REASONS = {
  overloaded: "Currently overloaded with tasks",
  wrong_stack: "Required stack doesn't match my skills",
  missing_context: "Task requirements unclear",
  blocked: "Blocked by dependencies",
  unavailable: "Not available at this time",
  other: "Other reason"
};

export default function AcceptanceQueue() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTask, setSelectedTask] = useState(null);
  const [showDeclineModal, setShowDeclineModal] = useState(false);
  const [showClarificationModal, setShowClarificationModal] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declineDetails, setDeclineDetails] = useState('');
  const [clarificationMessage, setClarificationMessage] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadAwaitingTasks();
  }, []);

  const loadAwaitingTasks = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API}/developer/tasks/awaiting-response`, { 
        withCredentials: true 
      });
      setTasks(response.data.tasks || []);
    } catch (error) {
      console.error('Error loading tasks:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (task) => {
    try {
      setProcessing(true);
      await axios.post(
        `${API}/developer/tasks/${task.unit_id}/accept`,
        {},
        { withCredentials: true }
      );
      
      // Remove from list
      setTasks(prev => prev.filter(t => t.unit_id !== task.unit_id));
      
      // Show success (you can add toast notification here)
      alert('Task accepted! You can now start working on it.');
    } catch (error) {
      console.error('Error accepting task:', error);
      alert(error.response?.data?.detail || 'Failed to accept task');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeclineClick = (task) => {
    setSelectedTask(task);
    setDeclineReason('');
    setDeclineDetails('');
    setShowDeclineModal(true);
  };

  const handleDeclineSubmit = async () => {
    if (!declineReason) {
      alert('Please select a reason');
      return;
    }

    try {
      setProcessing(true);
      await axios.post(
        `${API}/developer/tasks/${selectedTask.unit_id}/decline`,
        { reason_type: declineReason, details: declineDetails },
        { 
          withCredentials: true,
          params: { reason_type: declineReason, details: declineDetails }
        }
      );
      
      // Remove from list
      setTasks(prev => prev.filter(t => t.unit_id !== selectedTask.unit_id));
      setShowDeclineModal(false);
      setSelectedTask(null);
      
      alert('Task declined. It will be reassigned to another developer.');
    } catch (error) {
      console.error('Error declining task:', error);
      alert(error.response?.data?.detail || 'Failed to decline task');
    } finally {
      setProcessing(false);
    }
  };

  const handleClarificationClick = (task) => {
    setSelectedTask(task);
    setClarificationMessage('');
    setShowClarificationModal(true);
  };

  const handleClarificationSubmit = async () => {
    if (!clarificationMessage.trim()) {
      alert('Please enter your question');
      return;
    }

    try {
      setProcessing(true);
      await axios.post(
        `${API}/developer/tasks/${selectedTask.unit_id}/clarification`,
        { message: clarificationMessage },
        { 
          withCredentials: true,
          params: { message: clarificationMessage }
        }
      );
      
      setShowClarificationModal(false);
      setSelectedTask(null);
      loadAwaitingTasks();
      
      alert('Clarification requested. Admin will respond shortly.');
    } catch (error) {
      console.error('Error requesting clarification:', error);
      alert(error.response?.data?.detail || 'Failed to request clarification');
    } finally {
      setProcessing(false);
    }
  };

  const getDeadlineBadge = (task) => {
    if (task.is_overdue) {
      return <Badge className="bg-red-500">⏰ Overdue</Badge>;
    } else if (task.deadline_minutes_remaining < 30) {
      return <Badge className="bg-orange-500">🔥 Urgent ({task.deadline_minutes_remaining}m left)</Badge>;
    } else {
      return <Badge variant="outline">{Math.floor(task.deadline_minutes_remaining / 60)}h {task.deadline_minutes_remaining % 60}m left</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg">Loading tasks...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Acceptance Queue</h1>
        <p className="text-muted-foreground mt-1">
          You have <span className="font-bold text-primary">{tasks.length}</span> task{tasks.length !== 1 ? 's' : ''} awaiting your response
        </p>
      </div>

      {/* Tasks */}
      {tasks.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <CheckCircle className="h-16 w-16 mx-auto mb-4 text-green-500" />
            <p className="text-xl font-medium">All caught up!</p>
            <p className="text-sm text-muted-foreground mt-2">No tasks awaiting acceptance</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <Card key={task.unit_id} className={`${task.is_overdue ? 'border-red-500 border-2' : ''}`}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      {task.title}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {task.project_name} • Est: {task.estimated_hours}h
                    </CardDescription>
                  </div>
                  {getDeadlineBadge(task)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Description */}
                <div className="prose prose-sm">
                  <p className="text-sm text-muted-foreground">{task.description || 'No description provided'}</p>
                </div>

                {/* WHY YOU Context */}
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <div className="text-primary font-medium text-sm">Why you?</div>
                  </div>
                  <div className="text-sm mt-1">{task.why_you}</div>
                </div>

                {/* Task Details */}
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">Priority</div>
                    <Badge variant="outline">{task.priority || 'medium'}</Badge>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Complexity</div>
                    <div className="font-medium">{task.complexity || 5}/10</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Required Stack</div>
                    <div className="flex gap-1 flex-wrap mt-1">
                      {task.required_stack && task.required_stack.length > 0 ? (
                        task.required_stack.map((tech, idx) => (
                          <Badge key={idx} variant="secondary" className="text-xs">{tech}</Badge>
                        ))
                      ) : (
                        <span className="text-muted-foreground">Not specified</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-2">
                  <Button 
                    onClick={() => handleAccept(task)} 
                    disabled={processing}
                    className="flex-1"
                  >
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Accept Task
                  </Button>
                  <Button 
                    variant="outline" 
                    onClick={() => handleDeclineClick(task)}
                    disabled={processing}
                    className="flex-1"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Can't Take
                  </Button>
                  <Button 
                    variant="ghost" 
                    onClick={() => handleClarificationClick(task)}
                    disabled={processing}
                  >
                    <HelpCircle className="h-4 w-4 mr-2" />
                    Need Info
                  </Button>
                </div>

                {/* Overdue Warning */}
                {task.is_overdue && (
                  <div className="flex items-center gap-2 text-red-600 text-sm border-t pt-3">
                    <AlertTriangle className="h-4 w-4" />
                    <span>This task is overdue for response. Please accept or decline ASAP.</span>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Decline Modal */}
      <Dialog open={showDeclineModal} onOpenChange={setShowDeclineModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline Task</DialogTitle>
            <DialogDescription>
              Please let us know why you can't take this task. This helps improve future assignments.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="decline-reason">Reason</Label>
              <Select value={declineReason} onValueChange={setDeclineReason}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason" />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DECLINE_REASONS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="decline-details">Additional Details (Optional)</Label>
              <Textarea
                id="decline-details"
                placeholder="Any additional context..."
                value={declineDetails}
                onChange={(e) => setDeclineDetails(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeclineModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleDeclineSubmit} disabled={processing || !declineReason}>
              Confirm Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clarification Modal */}
      <Dialog open={showClarificationModal} onOpenChange={setShowClarificationModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Clarification</DialogTitle>
            <DialogDescription>
              What information do you need to better understand this task?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="clarification-message">Your Question</Label>
              <Textarea
                id="clarification-message"
                placeholder="Please explain in detail what needs clarification..."
                value={clarificationMessage}
                onChange={(e) => setClarificationMessage(e.target.value)}
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClarificationModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleClarificationSubmit} disabled={processing || !clarificationMessage.trim()}>
              Send Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
