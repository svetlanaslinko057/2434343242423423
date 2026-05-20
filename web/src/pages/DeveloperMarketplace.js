import { useState, useEffect } from 'react';
import { useAuth } from '@/App';
import axios from 'axios';
import { DollarSign, Clock, Shield, TrendingUp, AlertCircle, ShoppingCart, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

/**
 * DEVELOPER MARKETPLACE
 * Темная тема, Elite/Public индикаторы, demand, capacity визуализация
 */

const API = process.env.REACT_APP_BACKEND_URL ? `${process.env.REACT_APP_BACKEND_URL}/api` : '/api';

const DeveloperMarketplace = () => {
  const { user } = useAuth();
  const [modules, setModules] = useState([]);
  const [myModules, setMyModules] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchModules = async () => {
    try {
      const [availableRes, myRes] = await Promise.all([
        axios.get(`${API}/marketplace/modules?status=open`, { withCredentials: true }),
        axios.get(`${API}/developer/marketplace/my-modules`, { withCredentials: true })
      ]);
      setModules(availableRes.data.modules || []);
      setMyModules(myRes.data.modules || []);
    } catch (error) {
      console.error('Failed to fetch modules:', error);
      toast.error('Failed to load marketplace');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModules();
  }, []);

  const acceptModule = async (moduleId) => {
    try {
      await axios.post(`${API}/marketplace/modules/${moduleId}/accept`, {}, { withCredentials: true });
      toast.success('Module accepted successfully!');
      fetchModules();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to accept module');
    }
  };

  const startModule = async (moduleId) => {
    try {
      await axios.post(`${API}/marketplace/modules/${moduleId}/start`, {}, { withCredentials: true });
      toast.success('Module started!');
      fetchModules();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to start module');
    }
  };

  const releaseModule = async (moduleId) => {
    try {
      await axios.post(`${API}/marketplace/modules/${moduleId}/release`, {}, { withCredentials: true });
      toast.success('Module released');
      fetchModules();
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to release module');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading marketplace...</p>
      </div>
    );
  }

  const capacity = myModules.length;
  const maxCapacity = 2;
  const isFull = capacity >= maxCapacity;

  return (
    <div className="min-h-screen bg-background text-foreground p-6" data-testid="developer-marketplace">
      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
              <ShoppingCart className="w-8 h-8" />
              Marketplace
            </h1>
            <p className="text-muted-foreground mt-1">Take modules and start earning</p>
          </div>

          {/* Capacity Indicator */}
          <div className="px-6 py-4 rounded-xl bg-card border border-border" data-testid="capacity-indicator">
            <p className="text-sm text-muted-foreground mb-1 uppercase tracking-wide">Active Capacity</p>
            <p className={`text-3xl font-bold font-mono ${isFull ? 'text-[color:var(--danger)]' : 'text-[color:var(--success)]'}`}>
              {capacity}/{maxCapacity}
            </p>
          </div>
        </div>

        {/* My Modules */}
        {myModules.length > 0 && (
          <div>
            <h2 className="text-xl font-bold text-foreground mb-4 flex items-center gap-2">
              My Modules ({myModules.length}/{maxCapacity})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {myModules.map((module) => (
                <Card 
                  key={module.module_id} 
                  className="bg-card border-2 border-[color:var(--info-border)] shadow-[var(--shadow-elev-1)]"
                  data-testid={`my-module-${module.module_id}`}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <h3 className="text-lg font-semibold text-foreground">
                          {module.title}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {module.project_name}
                        </p>
                      </div>
                      <Badge className="ml-2 bg-[color:var(--info-surface)] border border-[color:var(--info-border)] text-[color:var(--info)]">
                        {module.status}
                      </Badge>
                    </div>
                    
                    <div className="space-y-2 mb-4">
                      <div className="flex items-center gap-2 text-sm">
                        <DollarSign className="w-4 h-4 text-[color:var(--success)]" />
                        <span className="text-foreground font-medium font-mono">${module.price}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{module.estimated_hours}h est</span>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      {module.status === 'reserved' && (
                        <Button 
                          onClick={() => startModule(module.module_id)} 
                          size="sm" 
                          className="flex-1 bg-foreground text-background hover:bg-foreground/90"
                          data-testid={`start-module-${module.module_id}`}
                        >
                          Start Working
                        </Button>
                      )}
                      {(module.status === 'reserved' || module.status === 'in_progress') && (
                        <Button 
                          onClick={() => releaseModule(module.module_id)} 
                          variant="outline" 
                          size="sm"
                          className="border-border text-foreground hover:bg-muted"
                          data-testid={`release-module-${module.module_id}`}
                        >
                          Release
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Available Modules */}
        <div>
          <h2 className="text-xl font-bold text-foreground mb-4">
            Available Work ({modules.length})
          </h2>

          {modules.length === 0 ? (
            <Card className="bg-card border border-dashed border-border p-12 text-center">
              <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No modules available at the moment</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {modules.map((module) => {
                const isElite = module.access_level === 'elite';
                const demand = module.demand || 'normal';
                
                return (
                  <Card 
                    key={module.module_id} 
                    className={`bg-card border transition-all hover:border-muted-foreground shadow-[var(--shadow-elev-1)] ${
                      isElite 
                        ? 'border-2 border-warning/30 relative overflow-hidden' 
                        : 'border-border'
                    }`}
                    data-testid={`module-${module.module_id}`}
                  >
                    {/* Elite Badge */}
                    {isElite && (
                      <div className="absolute top-0 right-0">
                        <div className="bg-signal/15 text-foreground px-3 py-1 text-xs font-bold flex items-center gap-1 rounded-bl-lg">
                          <Crown className="w-3 h-3" />
                          ELITE
                        </div>
                      </div>
                    )}

                    <CardContent className="p-6">
                      <div className="mb-4">
                        <h3 className="text-lg font-semibold text-foreground mb-2">
                          {module.title}
                        </h3>
                        <p className="text-sm text-muted-foreground mb-2">
                          {module.project_name}
                        </p>
                        {module.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {module.description}
                          </p>
                        )}
                      </div>

                      {/* Scope */}
                      {module.scope && module.scope.length > 0 && (
                        <div className="mb-4">
                          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Scope:</p>
                          <ul className="text-xs text-muted-foreground space-y-1">
                            {module.scope.slice(0, 3).map((item, idx) => (
                              <li key={idx}>• {item}</li>
                            ))}
                            {module.scope.length > 3 && (
                              <li className="text-muted-foreground">+ {module.scope.length - 3} more</li>
                            )}
                          </ul>
                        </div>
                      )}

                      {/* Demand Indicator */}
                      {demand !== 'normal' && (
                        <div className="mb-3">
                          <Badge className={`
                            ${demand === 'high' ? 'bg-[color:var(--danger-surface)] border-[color:var(--danger-border)] text-[color:var(--danger)]' : ''}
                            ${demand === 'urgent' ? 'bg-[color:var(--warning-surface)] border-[color:var(--warning-border)] text-[color:var(--warning)] animate-pulse' : ''}
                          `}>
                            <TrendingUp className="w-3 h-3 mr-1" />
                            {demand === 'high' ? 'High Demand' : 'URGENT'}
                          </Badge>
                        </div>
                      )}

                      {/* Price & Time */}
                      <div className="space-y-2 mb-4 pt-4 border-t border-border">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Reward:</span>
                          <span className="text-lg font-bold font-mono text-[color:var(--success)]">${module.price}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Time:</span>
                          <span className="text-sm text-foreground">{module.estimated_hours}h</span>
                        </div>
                      </div>

                      <Button
                        onClick={() => acceptModule(module.module_id)}
                        disabled={isFull}
                        className="w-full bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed"
                        size="sm"
                        data-testid={`take-module-${module.module_id}`}
                      >
                        {isFull ? 'Capacity Full (2/2)' : 'Take Module'}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeveloperMarketplace;
