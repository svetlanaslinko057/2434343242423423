import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/App';
// ─── Runtime-client migration (Batch 1 — Web Admin Finance) ─────────────
// Transport-swap only. Local loading/creating state preserved (doctrine).
// Invoice creation + mark-paid are ledger mutations but funds move via
// separate Stripe/WayForPay/manual flows, so no `capability: 'payment'`
// gate here (consistent with AdminBillingPage).
import { runtime } from '@/runtime';
import { ApiError } from '@/runtime-client';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Clock,
  AlertTriangle,
  CheckCircle2,
  FileText,
  Plus,
  Loader2,
  BarChart3,
  PieChart,
  Receipt,
  Wallet
} from 'lucide-react';

const AdminFinancialsPage = () => {
  const { projectId } = useParams();
  const { user } = useAuth();
  const [financials, setFinancials] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateInvoice, setShowCreateInvoice] = useState(false);
  const [newInvoice, setNewInvoice] = useState({ title: '', amount: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (projectId) {
      fetchData();
    }
  }, [projectId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [financialsRes, invoicesRes] = await Promise.all([
        runtime.get(`/api/admin/projects/${projectId}/financials`),
        runtime.get(`/api/billing/invoices/${projectId}`),
      ]);
      setFinancials(financialsRes.data);
      setInvoices(invoicesRes.data || []);
    } catch (error) {
      // Preserve original telemetry surface (no UI change).
      console.error('Error fetching financials:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateInvoice = async () => {
    if (!newInvoice.title || !newInvoice.amount) return;
    setCreating(true);
    try {
      // Get project to find client_id
      const projectRes = await runtime.get(`/api/projects/${projectId}`);
      const clientId = projectRes.data?.client_id;

      await runtime.post(`/api/billing/invoice`, {
        project_id: projectId,
        client_id: clientId,
        title: newInvoice.title,
        amount: parseFloat(newInvoice.amount),
      }, {
        // Title+amount+project make a natural dedup key for double-click guard.
        idempotencyKey: `create-invoice:${projectId}:${newInvoice.title}:${newInvoice.amount}`,
      });

      setShowCreateInvoice(false);
      setNewInvoice({ title: '', amount: '' });
      fetchData();
    } catch (error) {
      const msg = error instanceof ApiError ? (error.hint || error.message) : 'Failed to create invoice';
      alert(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleMarkPaid = async (invoiceId) => {
    try {
      await runtime.post(`/api/billing/invoice/${invoiceId}/mark-paid`, {}, {
        idempotencyKey: `markpaid:${invoiceId}`,
      });
      fetchData();
    } catch (error) {
      const msg = error instanceof ApiError ? (error.hint || error.message) : 'Failed to mark as paid';
      alert(msg);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const healthColor = financials?.health === 'good' ? 'text-emerald-400' :
                      financials?.health === 'risk' ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="space-y-6" data-testid="admin-financials-page">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-3">
            <BarChart3 className="w-7 h-7 text-emerald-400" />
            Project Financials
          </h1>
          <p className="text-muted-foreground mt-1">Revenue, cost, and profit analysis</p>
        </div>
        <button
          onClick={() => setShowCreateInvoice(true)}
          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl transition-colors flex items-center gap-2"
          data-testid="create-invoice-btn"
        >
          <Plus className="w-4 h-4" />
          Create Invoice
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-6 rounded-2xl border border-border bg-[var(--t-surface-raised)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground text-sm">Revenue</span>
            <DollarSign className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-3xl font-bold text-emerald-400">${financials?.revenue || 0}</div>
          <div className="text-xs text-muted-foreground mt-1">{financials?.invoices_count || 0} paid invoices</div>
        </div>

        <div className="p-6 rounded-2xl border border-border bg-[var(--t-surface-raised)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground text-sm">Cost</span>
            <Wallet className="w-5 h-5 text-red-400" />
          </div>
          <div className="text-3xl font-bold text-red-400">${financials?.cost || 0}</div>
          <div className="text-xs text-muted-foreground mt-1">{financials?.total_hours || 0} hours logged</div>
        </div>

        <div className="p-6 rounded-2xl border border-border bg-[var(--t-surface-raised)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground text-sm">Profit</span>
            {(financials?.profit || 0) >= 0 ? 
              <TrendingUp className="w-5 h-5 text-emerald-400" /> :
              <TrendingDown className="w-5 h-5 text-red-400" />
            }
          </div>
          <div className={`text-3xl font-bold ${(financials?.profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            ${financials?.profit || 0}
          </div>
        </div>

        <div className="p-6 rounded-2xl border border-border bg-[var(--t-surface-raised)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-muted-foreground text-sm">Margin</span>
            <PieChart className={`w-5 h-5 ${healthColor}`} />
          </div>
          <div className={`text-3xl font-bold ${healthColor}`}>
            {financials?.margin || 0}%
          </div>
          <div className={`text-xs mt-1 ${healthColor}`}>
            {financials?.health === 'good' ? 'Healthy' :
             financials?.health === 'risk' ? 'At Risk' : 'Critical'}
          </div>
        </div>
      </div>

      {/* Alerts */}
      {financials?.alerts?.length > 0 && (
        <div className="space-y-2">
          {financials.alerts.map((alert, i) => (
            <div key={i} className={`p-4 rounded-xl flex items-center gap-3 ${
              alert.type === 'critical' ? 'bg-red-500/10 border border-red-500/30' :
              'bg-amber-500/10 border border-amber-500/30'
            }`}>
              <AlertTriangle className={`w-5 h-5 ${
                alert.type === 'critical' ? 'text-red-400' : 'text-amber-400'
              }`} />
              <span className={alert.type === 'critical' ? 'text-red-400' : 'text-amber-400'}>
                {alert.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Invoices */}
      <div className="rounded-2xl border border-border bg-[var(--t-surface-raised)] overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <Receipt className="w-5 h-5 text-signal" />
            Invoices
          </h2>
        </div>
        
        {invoices.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No invoices yet</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {invoices.map(invoice => (
              <div key={invoice.invoice_id} className="p-4 flex items-center justify-between hover:bg-muted">
                <div className="flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    invoice.status === 'paid' ? 'bg-emerald-500/20' :
                    invoice.status === 'pending_payment' ? 'bg-amber-500/20' :
                    'bg-muted'
                  }`}>
                    {invoice.status === 'paid' ? 
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" /> :
                      <Clock className="w-5 h-5 text-amber-400" />
                    }
                  </div>
                  <div>
                    <div className="font-medium text-white">{invoice.title}</div>
                    <div className="text-sm text-muted-foreground">
                      {new Date(invoice.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-semibold text-white">${invoice.amount}</div>
                    <div className={`text-xs ${
                      invoice.status === 'paid' ? 'text-emerald-400' : 'text-amber-400'
                    }`}>
                      {invoice.status === 'paid' ? 'Paid' : 'Pending'}
                    </div>
                  </div>
                  {invoice.status === 'pending_payment' && (
                    <button
                      onClick={() => handleMarkPaid(invoice.invoice_id)}
                      className="px-3 py-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 text-sm rounded-lg transition-colors"
                    >
                      Mark Paid
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Invoice Modal */}
      {showCreateInvoice && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[var(--t-surface-raised)] border border-border rounded-2xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Create Invoice</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Title</label>
                <input
                  value={newInvoice.title}
                  onChange={(e) => setNewInvoice({...newInvoice, title: e.target.value})}
                  placeholder="e.g. Milestone 1 Payment"
                  className="w-full bg-black/30 border border-border rounded-xl p-3 text-white"
                  data-testid="invoice-title-input"
                />
              </div>
              <div>
                <label className="block text-sm text-muted-foreground mb-2">Amount (USD)</label>
                <input
                  type="number"
                  value={newInvoice.amount}
                  onChange={(e) => setNewInvoice({...newInvoice, amount: e.target.value})}
                  placeholder="1000"
                  className="w-full bg-black/30 border border-border rounded-xl p-3 text-white"
                  data-testid="invoice-amount-input"
                />
              </div>
              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleCreateInvoice}
                  disabled={creating || !newInvoice.title || !newInvoice.amount}
                  className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
                  data-testid="submit-invoice-btn"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Create Invoice'}
                </button>
                <button
                  onClick={() => setShowCreateInvoice(false)}
                  className="px-4 py-3 border border-border hover:bg-muted text-muted-foreground rounded-xl transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminFinancialsPage;
