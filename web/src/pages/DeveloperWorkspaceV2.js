import { useState, useEffect } from 'react';
import { useAuth, API } from '@/App';
import axios from 'axios';
import { Target, Zap, AlertCircle, Clock, TrendingUp, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function DeveloperWorkspaceV2() {
  const { user } = useAuth();
  const [focusTask, setFocusTask] = useState(null);
  const [workload, setWorkload] = useState(null);
  const [performance, setPerformance] = useState(null);
  const [activeTab, setActiveTab] = useState('focus');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWorkspaceData();
  }, []);

  const loadWorkspaceData = async () => {
    try {
      setLoading(true);
      const [focusRes, workloadRes, performanceRes] = await Promise.all([
        axios.get(`${API}/developer/focus`, { withCredentials: true }),
        axios.get(`${API}/developer/workload`, { withCredentials: true }),
        axios.get(`${API}/developer/performance`, { withCredentials: true })
      ]);
      
      setFocusTask(focusRes.data);
      setWorkload(workloadRes.data);
      setPerformance(performanceRes.data);
    } catch (error) {
      console.error('Error loading workspace:', error);
    } finally {
      setLoading(false);
    }
  };

  const getLoadBadge = (status) => {
    const badges = {
      available: { label: '🟢 Available', className: 'bg-green-500' },
      optimal: { label: '🟡 Optimal', className: 'bg-yellow-500' },
      overloaded: { label: '🔴 Overloaded', className: 'bg-red-500' }
    };
    return badges[status] || badges.available;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg">Loading workspace...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Developer Workspace</h1>
          <p className="text-muted-foreground mt-1">Focus zone, active work, and performance</p>
        </div>
        {workload && (
          <Badge className={getLoadBadge(workload.load_status).className}>
            {getLoadBadge(workload.load_status).label}
          </Badge>
        )}
      </div>

      {/* Workload Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Utilization</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{workload?.utilization_percent || 0}%</div>
            <Progress value={workload?.utilization_percent || 0} className="mt-2" />
            <p className="text-xs text-muted-foreground mt-1">
              {workload?.current_load_hours || 0}h / {workload?.capacity_hours_per_week || 0}h
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Tasks</CardTitle>
            <Zap className="h-4 w-4 text-signal" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{workload?.active_tasks_count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">In progress</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Revisions</CardTitle>
            <AlertCircle className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{workload?.revision_tasks_count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Need fixing</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">QA Pass Rate</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{performance ? Math.round(performance.qa_pass_rate * 100) : 0}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              {performance?.approved_submissions || 0} / {performance?.total_submissions || 0}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="focus">🎯 Focus</TabsTrigger>
          <TabsTrigger value="active">⚡ Active</TabsTrigger>
          <TabsTrigger value="revisions">🔧 Revisions</TabsTrigger>
          <TabsTrigger value="queue">📋 Queue</TabsTrigger>
          <TabsTrigger value="performance">📊 Performance</TabsTrigger>
        </TabsList>

        {/* Focus Zone */}
        <TabsContent value="focus" className="space-y-4">
          {focusTask ? (
            <Card className="border-2 border-primary">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-primary" />
                  <CardTitle>Main Focus Task</CardTitle>
                </div>
                <CardDescription>Your highest priority task right now</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-2xl font-bold mb-2">{focusTask.title}</div>
                  <div className="text-sm text-muted-foreground mb-4">
                    {focusTask.project_name} • Priority Score: {Math.round(focusTask.priority_score * 100)}%
                  </div>
                  <div className="prose prose-sm">
                    <p>{focusTask.description}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 p-4 bg-accent rounded-lg">
                  <div>
                    <div className="text-sm text-muted-foreground">Why Focus?</div>
                    <div className="font-medium">{focusTask.why_focus}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">What Next?</div>
                    <div className="font-medium">{focusTask.what_next}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Estimated</div>
                    <div className="font-medium">{focusTask.estimated_hours}h</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Status</div>
                    <Badge>{focusTask.status}</Badge>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button className="flex-1">
                    <Zap className="h-4 w-4 mr-2" />
                    Start Working
                  </Button>
                  <Button variant="outline" className="flex-1">
                    View Details
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="text-center py-12">
                <Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <p className="text-lg font-medium">No focus task assigned</p>
                <p className="text-sm text-muted-foreground">All tasks completed or no assignments yet</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Active Work */}
        <TabsContent value="active" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Work</CardTitle>
              <CardDescription>Tasks currently in progress</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <p>Active tasks list (connect to /developer/work-units)</p>
                <p className="text-sm mt-2">{workload?.active_tasks_count || 0} tasks active</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Revisions */}
        <TabsContent value="revisions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Revisions Needed</CardTitle>
              <CardDescription>Tasks returned from QA</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle className="h-12 w-12 mx-auto mb-2 text-orange-500" />
                <p>{workload?.revision_tasks_count || 0} tasks need fixing</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Queue */}
        <TabsContent value="queue" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Task Queue</CardTitle>
              <CardDescription>Upcoming tasks to pick up</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <p>Queued tasks (assigned but not started)</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Performance */}
        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Quality Metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm">QA Pass Rate</span>
                    <span className="text-sm font-medium">{performance ? Math.round(performance.qa_pass_rate * 100) : 0}%</span>
                  </div>
                  <Progress value={performance ? performance.qa_pass_rate * 100 : 0} />
                </div>
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm">Revision Rate</span>
                    <span className="text-sm font-medium">{performance ? Math.round(performance.revision_rate * 100) : 0}%</span>
                  </div>
                  <Progress value={performance ? performance.revision_rate * 100 : 0} className="bg-red-100" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Delivery Metrics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Tasks Completed</div>
                    <div className="text-2xl font-bold">{performance?.tasks_completed || 0}</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Avg Time</div>
                    <div className="text-2xl font-bold">{performance?.avg_completion_time || 0}h</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}