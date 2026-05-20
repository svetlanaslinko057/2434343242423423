import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { runtime } from '@/runtime';
import { Users, Activity, AlertTriangle, TrendingUp, Zap, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function AdminTeamPanel() {
  const [capacity, setCapacity] = useState(null);
  const [developers, setDevelopers] = useState([]);
  const [bottlenecks, setBottlenecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadTeamData();
  }, []);

  const loadTeamData = async () => {
    try {
      setLoading(true);
      // Three independent reads — runtime dedup middleware (P1 #10) coalesces
      // any overlap if the user mashes Refresh. No client-side merging per
      // ARCHITECTURE.md "UI does not merge endpoints".
      const [capacityRes, devsRes, bottlenecksRes] = await Promise.all([
        runtime.get('/api/admin/team/capacity'),
        runtime.get('/api/admin/team/developers'),
        runtime.get('/api/admin/team/bottlenecks'),
      ]);

      setCapacity(capacityRes.data);
      setDevelopers(devsRes.data);
      setBottlenecks(bottlenecksRes.data);
    } catch (error) {
      // Telemetry surface — kept per doctrine 2026-05-13.
      console.error('Error loading team data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getLoadBadge = (status) => {
    const variants = {
      available: { variant: 'default', label: '🟢 Available', className: 'bg-green-500' },
      optimal: { variant: 'secondary', label: '🟡 Optimal', className: 'bg-yellow-500' },
      overloaded: { variant: 'destructive', label: '🔴 Overloaded', className: 'bg-red-500' }
    };
    return variants[status] || variants.available;
  };

  const getRoleBadge = (role) => {
    const colors = {
      frontend: 'bg-signal',
      backend: 'bg-signal',
      fullstack: 'bg-signal',
      designer: 'bg-signal',
      qa: 'bg-orange-500'
    };
    return colors[role] || 'bg-gray-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-lg">Loading team data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">Team Orchestration Panel</h1>
        <p className="text-muted-foreground mt-1">Capacity management, load balancing, and assignment control</p>
      </div>

      {/* Capacity Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Team Utilization</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{capacity ? Math.round(capacity.utilization * 100) : 0}%</div>
            <p className="text-xs text-muted-foreground mt-1">
              {capacity?.total_load || 0}h / {capacity?.total_capacity || 0}h capacity
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Available</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{capacity?.available_count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Developers ready</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Optimal</CardTitle>
            <TrendingUp className="h-4 w-4 text-yellow-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{capacity?.optimal_count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">In flow state</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Overloaded</CardTitle>
            <AlertTriangle className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{capacity?.overloaded_count || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">Need rebalance</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="people" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="people">People View</TabsTrigger>
          <TabsTrigger value="capacity">Capacity View</TabsTrigger>
          <TabsTrigger value="risk">Risk View</TabsTrigger>
          <TabsTrigger value="action">Actions</TabsTrigger>
        </TabsList>

        {/* People View */}
        <TabsContent value="people" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>Individual developer load and performance</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2">Developer</th>
                        <th className="text-left p-2">Role</th>
                        <th className="text-left p-2">Load</th>
                        <th className="text-left p-2">QA Rate</th>
                        <th className="text-left p-2">Tasks</th>
                        <th className="text-left p-2">Status</th>
                        <th className="text-left p-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {developers.map((dev) => {
                        const badge = getLoadBadge(dev.load_status);
                        return (
                          <tr key={dev.user_id} className="border-b hover:bg-accent">
                            <td className="p-2">
                              <div>
                                <div className="font-medium">{dev.name}</div>
                                <div className="text-xs text-muted-foreground">{dev.level}</div>
                              </div>
                            </td>
                            <td className="p-2">
                              <Badge className={getRoleBadge(dev.role)}>{dev.role}</Badge>
                            </td>
                            <td className="p-2">
                              <div>
                                <div className="font-medium">{Math.round(dev.load_index * 100)}%</div>
                                <div className="text-xs text-muted-foreground">
                                  {dev.current_load_hours}h / {dev.capacity_hours_per_week}h
                                </div>
                              </div>
                            </td>
                            <td className="p-2">
                              <div className="font-medium">{Math.round(dev.qa_pass_rate * 100)}%</div>
                            </td>
                            <td className="p-2">
                              <div>
                                <div className="font-medium">{dev.active_tasks_count} active</div>
                                <div className="text-xs text-muted-foreground">
                                  {dev.tasks_completed} total
                                </div>
                              </div>
                            </td>
                            <td className="p-2">
                              <Badge className={badge.className}>{badge.label}</Badge>
                            </td>
                            <td className="p-2">
                              <Button size="sm" variant="ghost">
                                View
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Capacity View */}
        <TabsContent value="capacity" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Capacity by Role</CardTitle>
              <CardDescription>Team distribution and utilization per role</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {capacity?.by_role && Object.entries(capacity.by_role).map(([role, data]) => (
                  <div key={role} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Badge className={getRoleBadge(role)}>{role}</Badge>
                        <span className="font-medium">{data.count} developers</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {Math.round(data.utilization * 100)}% utilization
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">Capacity</div>
                        <div className="font-medium">{data.capacity}h</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Load</div>
                        <div className="font-medium">{data.load}h</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Available</div>
                        <div className="font-medium">{data.available}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Overloaded</div>
                        <div className="font-medium">{data.overloaded}</div>
                      </div>
                    </div>
                    <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${data.utilization > 0.8 ? 'bg-red-500' : data.utilization > 0.5 ? 'bg-yellow-500' : 'bg-green-500'}`}
                        style={{ width: `${Math.min(data.utilization * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Risk View */}
        <TabsContent value="risk" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Bottlenecks & Risks</CardTitle>
              <CardDescription>Overloaded developers and quality issues</CardDescription>
            </CardHeader>
            <CardContent>
              {bottlenecks?.bottlenecks && bottlenecks.bottlenecks.length > 0 ? (
                <div className="space-y-3">
                  {bottlenecks.bottlenecks.map((item) => (
                    <div key={item.developer_id} className="border-l-4 border-red-500 pl-4 py-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{item.developer_name}</div>
                          <div className="text-sm text-muted-foreground">
                            {item.role} • {item.active_tasks} tasks • {Math.round(item.load_index * 100)}% load
                          </div>
                        </div>
                        <Badge variant="destructive">Overloaded</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-500" />
                  <p>No bottlenecks detected. Team is balanced!</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Rebalance Opportunities */}
          {bottlenecks?.rebalance_opportunities && bottlenecks.rebalance_opportunities.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Rebalance Opportunities</CardTitle>
                <CardDescription>Suggested task reassignments</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {bottlenecks.rebalance_opportunities.map((opp, idx) => (
                    <div key={idx} className="border rounded-lg p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="font-medium">{opp.task_title}</div>
                          <div className="text-sm text-muted-foreground">
                            {opp.from_developer} ({Math.round(opp.from_load * 100)}% load) → {opp.to_developer}
                          </div>
                        </div>
                        <Button size="sm" variant="outline">
                          <Zap className="h-4 w-4 mr-1" />
                          Reassign
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Actions */}
        <TabsContent value="action" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Team Actions</CardTitle>
              <CardDescription>Manual controls for team orchestration</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <Button className="w-full" onClick={loadTeamData}>
                  <Activity className="h-4 w-4 mr-2" />
                  Refresh Team Data
                </Button>
                <Button className="w-full" variant="outline" disabled title="Auto-Rebalance unlocks after 3 completed projects">
                  <Zap className="h-4 w-4 mr-2" />
                  Auto-Rebalance
                  <span className="ml-2 px-1.5 py-0.5 text-[9px] font-semibold rounded bg-primary/10 text-primary border border-primary/20">BETA</span>
                </Button>
                <Button className="w-full" variant="outline" onClick={() => navigate('/admin/control-center')}>
                  <Users className="h-4 w-4 mr-2" />
                  Back to Control Center
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}