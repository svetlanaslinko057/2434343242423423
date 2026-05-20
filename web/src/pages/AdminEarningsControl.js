import { useState, useEffect } from 'react';
import { useAuth } from '@/App';
// ─── Runtime-client migration (Batch 1 — Web Admin Finance) ─────────────
// Transport-swap only. Local loading/refreshing/isCreatingBatch state preserved
// (doctrine). `payout/batches/approve` is the REAL money-dispatch boundary —
// it gets `capability: 'payment'` so the request is hard-gated when payment
// integration is not LIVE (consistent with AdminV2Finance pilot). Other
// admin reads (overview/approved/held/flagged) stay soft so the dashboard
// keeps working in mock mode.
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import { DollarSign, RefreshCw } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Components
import FinancialControlHeader from '@/components/admin/FinancialControlHeader';
import ReadyForBatchQueue from '@/components/admin/ReadyForBatchQueue';
import BatchManager from '@/components/admin/BatchManager';
import BatchPreviewDialog from '@/components/admin/BatchPreviewDialog';
import BatchDetailSheet from '@/components/admin/BatchDetailSheet';
import HeldQueue from '@/components/admin/HeldQueue';
import FlaggedQueue from '@/components/admin/FlaggedQueue';
import RiskSignalsPanel from '@/components/admin/RiskSignalsPanel';
import ProjectDevCostPanel from '@/components/admin/ProjectDevCostPanel';

const AdminEarningsControl = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  
  // Data states
  const [overview, setOverview] = useState(null);
  const [approvedQueue, setApprovedQueue] = useState([]);
  const [batches, setBatches] = useState([]);
  const [heldEarnings, setHeldEarnings] = useState([]);
  const [flaggedEarnings, setFlaggedEarnings] = useState([]);
  const [projects, setProjects] = useState([]);
  
  // UI states
  const [activeTab, setActiveTab] = useState('ready');
  const [selectedBatch, setSelectedBatch] = useState(null);
  const [selectedDeveloper, setSelectedDeveloper] = useState(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreatingBatch, setIsCreatingBatch] = useState(false);

  const fetchEarningsData = async (isRefresh = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      const [overviewRes, approvedRes, batchesRes, heldRes, flaggedRes] = await Promise.all([
        runtime.get(`/api/admin/earnings/overview`),
        runtime.get(`/api/admin/earnings/approved`),
        runtime.get(`/api/admin/payout/batches`),
        runtime.get(`/api/admin/earnings/held`),
        runtime.get(`/api/admin/earnings/flagged`),
      ]);

      setOverview(overviewRes.data);
      setApprovedQueue(approvedRes.data.developers || []);
      setBatches(batchesRes.data.batches || []);
      setHeldEarnings(heldRes.data.held || []);
      setFlaggedEarnings(flaggedRes.data.flagged || []);

      // Real projects list (Этап 4 — Honest Runtime)
      try {
        const projRes = await runtime.get(`/api/admin/projects`);
        setProjects(projRes.data.projects || projRes.data || []);
      } catch (_) {
        setProjects([]);
      }
    } catch (error) {
      console.error('Error fetching admin earnings data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (user && user.role === 'admin') {
      fetchEarningsData();
    }
  }, [user]);

  const handleRefresh = () => {
    fetchEarningsData(true);
  };

  const handleCreateBatch = (developer) => {
    setSelectedDeveloper(developer);
    setIsPreviewOpen(true);
  };

  const handleConfirmCreateBatch = async () => {
    if (!selectedDeveloper) return;

    try {
      setIsCreatingBatch(true);

      // Batch CREATION doesn't move money (it just groups approved earnings
      // into a payout batch). Money movement happens on `/approve`. So no
      // capability gate here, but idempotency stays — admin double-click
      // protection over a list of earning_ids.
      await runtime.post(
        `/api/admin/payout/batches`,
        {
          user_id: selectedDeveloper.user_id,
          earning_ids: selectedDeveloper.earnings.map(e => e.earning_id),
        },
        {
          idempotencyKey: `batch:${selectedDeveloper.user_id}:${selectedDeveloper.earnings.map(e => e.earning_id).join(',')}`,
        },
      );

      // Close dialog
      setIsPreviewOpen(false);
      setSelectedDeveloper(null);

      // Refresh data
      await fetchEarningsData(true);
    } catch (error) {
      console.error('Error creating batch:', error);
    } finally {
      setIsCreatingBatch(false);
    }
  };

  const handleApproveBatch = async (batch) => {
    try {
      // REAL MONEY DISPATCH — must be capability-gated. When payment
      // integration is not LIVE, runtime-client will reject with
      // ApiError(code='capability_offline') before the request hits backend.
      await runtime.post(
        `/api/admin/payout/batches/${batch.batch_id}/approve`,
        {},
        {
          capability: 'payment',
          idempotencyKey: `approve-batch:${batch.batch_id}`,
        },
      );

      // Refresh data
      await fetchEarningsData(true);
    } catch (error) {
      console.error('Error approving batch:', error);
    }
  };

  const handleMarkPaid = async (batch) => {
    try {
      // Mark-paid finalises an out-of-band payment — at this point money
      // has already moved, so we record the fact in the ledger. No
      // capability gate, but idempotency to prevent double-recording.
      await runtime.post(
        `/api/admin/payout/batches/${batch.batch_id}/mark-paid`,
        {},
        { idempotencyKey: `markpaid-batch:${batch.batch_id}` },
      );

      // Refresh data
      await fetchEarningsData(true);
    } catch (error) {
      console.error('Error marking batch as paid:', error);
    }
  };

  const handleBatchClick = async (batch) => {
    try {
      // Fetch full batch details with earnings snapshot
      const response = await runtime.get(
        `/api/admin/payout/batches/${batch.batch_id}`,
      );

      setSelectedBatch(response.data);
      setIsDetailOpen(true);
    } catch (error) {
      console.error('Error fetching batch details:', error);
      // Fallback to basic batch data
      setSelectedBatch(batch);
      setIsDetailOpen(true);
    }
  };

  const handleNavigate = (tab) => {
    setActiveTab(tab);
  };

  const handleOpenQA = (earning) => {
    // Honest: opens task QA history in a new tab (canonical route).
    // Was: TODO + console.log (audit P2 #15).
    if (earning?.task_id) {
      window.open(`/api/web-ui/admin/work-units/${earning.task_id}`, '_blank');
    }
  };

  const handleReviewFlagged = (earning) => {
    // Stage 2 (May 9, 2026): canonical behavior — navigate to flagged tab and
    // surface the row. There is intentionally NO separate "resolve flag" action.
    //
    // Flag lifecycle is system-driven, not admin-driven:
    //   1. QA layer auto-flags when confidence is low (earnings_layer.py:497)
    //   2. Admin reviews on flagged tab (this action)
    //   3. Resolution happens by RE-running the QA flow on the underlying
    //      work-unit (POST /api/admin/qa/{module_id}/{approve|reject|revision}).
    //      The earning's flagged status is then auto-cleared by earnings_layer.
    //
    // A dedicated "AdminFlagReviewModal" was considered (audit P2 #15) and
    // explicitly rejected — adding admin-side flag mutation would let admins
    // bypass QA, breaking the money-ledger contract that ties earnings to
    // QA decisions only.
    if (earning?.earning_id) {
      setActiveTab('flagged');
      // Scroll to the row after tab swap renders it.
      setTimeout(() => {
        const el = document.getElementById(`flagged-row-${earning.earning_id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  };

  const approvedBatchesNotPaid = batches.filter(b => b.status === 'approved').length;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-surface">
              <DollarSign className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-text-primary">
                Earnings Control
              </h1>
              <p className="text-sm text-text-secondary mt-1">
                Manage developer earnings, batches, and payouts
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface border border-border hover:border-primary/30 transition-colors text-sm font-medium text-text-primary disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Main Content */}
        <div className="space-y-8">
          {/* 1. Financial Control Header */}
          <FinancialControlHeader overview={overview} />

          {/* 2. Risk Signals Panel */}
          <RiskSignalsPanel
            overview={overview}
            heldCount={heldEarnings.length}
            flaggedCount={flaggedEarnings.length}
            flaggedEarnings={flaggedEarnings}
            approvedBatchesNotPaid={approvedBatchesNotPaid}
            onNavigate={handleNavigate}
          />

          {/* 3. Main Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="bg-surface border border-border">
              <TabsTrigger value="ready">Ready for Batch</TabsTrigger>
              <TabsTrigger value="held">Held Queue</TabsTrigger>
              <TabsTrigger value="flagged">Flagged Queue</TabsTrigger>
              <TabsTrigger value="batches">Batch Manager</TabsTrigger>
            </TabsList>

            {/* Ready for Batch Queue */}
            <TabsContent value="ready" className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-text-primary mb-4">
                  Approved Earnings Queue
                </h3>
                <ReadyForBatchQueue 
                  developers={approvedQueue} 
                  onCreateBatch={handleCreateBatch}
                />
              </div>
            </TabsContent>

            {/* Held Queue */}
            <TabsContent value="held" className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-text-primary mb-4">
                  QA-Blocked Earnings
                </h3>
                <HeldQueue 
                  heldEarnings={heldEarnings}
                  onOpenQA={handleOpenQA}
                />
              </div>
            </TabsContent>

            {/* Flagged Queue */}
            <TabsContent value="flagged" className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-text-primary mb-4">
                  Trust-Blocked Earnings
                </h3>
                <FlaggedQueue 
                  flaggedEarnings={flaggedEarnings}
                  onReview={handleReviewFlagged}
                />
              </div>
            </TabsContent>

            {/* Batch Manager */}
            <TabsContent value="batches" className="space-y-4">
              <BatchManager 
                batches={batches}
                onApprove={handleApproveBatch}
                onMarkPaid={handleMarkPaid}
                onBatchClick={handleBatchClick}
              />
            </TabsContent>
          </Tabs>

          {/* 4. Project Dev Cost Panel */}
          <ProjectDevCostPanel projects={projects} />
        </div>

        {/* Dialogs */}
        <BatchPreviewDialog
          isOpen={isPreviewOpen}
          onClose={() => {
            setIsPreviewOpen(false);
            setSelectedDeveloper(null);
          }}
          developer={selectedDeveloper}
          onConfirm={handleConfirmCreateBatch}
          isCreating={isCreatingBatch}
        />

        <BatchDetailSheet
          isOpen={isDetailOpen}
          onClose={() => {
            setIsDetailOpen(false);
            setSelectedBatch(null);
          }}
          batch={selectedBatch}
        />
      </div>
    </div>
  );
};

export default AdminEarningsControl;
