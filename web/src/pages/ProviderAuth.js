import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, API } from '@/App';
import axios from 'axios';
import {
  Car,
  Wrench,
  Zap,
  ArrowRight,
  Loader2
} from 'lucide-react';

const ProviderAuth = () => {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleDemoLogin = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/auth/demo-provider`, {}, { withCredentials: true });
      setUser(res.data);
      navigate('/provider/inbox');
    } catch (error) {
      console.error('Error logging in:', error);
      alert('Помилка входу');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--t-bg)] text-white flex flex-col" data-testid="provider-auth">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-20 h-20 bg-emerald-500 rounded-3xl flex items-center justify-center mb-8">
          <Wrench className="w-10 h-10 text-white" />
        </div>
        
        <h1 className="text-3xl font-bold text-center mb-4">
          Автомаркет
        </h1>
        <p className="text-muted-foreground text-center mb-12 max-w-xs">
          Платформа для автомайстрів. Отримуй заявки, заробляй більше.
        </p>

        {/* Features */}
        <div className="w-full max-w-sm space-y-4 mb-12">
          <div className="flex items-center gap-4 p-4 rounded-xl bg-muted border border-border">
            <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center">
              <Zap className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="font-medium">Миттєві заявки</div>
              <div className="text-sm text-muted-foreground">Отримуй замовлення за секунди</div>
            </div>
          </div>
          
          <div className="flex items-center gap-4 p-4 rounded-xl bg-muted border border-border">
            <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
              <Car className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <div className="font-medium">Поруч з тобою</div>
              <div className="text-sm text-muted-foreground">Заявки у твоєму радіусі</div>
            </div>
          </div>
          
          <div className="flex items-center gap-4 p-4 rounded-xl bg-muted border border-border">
            <div className="w-10 h-10 bg-signal/20 rounded-lg flex items-center justify-center">
              <Wrench className="w-5 h-5 text-signal" />
            </div>
            <div>
              <div className="font-medium">Quick Mode</div>
              <div className="text-sm text-muted-foreground">Автоматичне прийняття</div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={handleDemoLogin}
          disabled={loading}
          className="w-full max-w-sm py-4 bg-emerald-500 text-white rounded-2xl font-semibold text-lg flex items-center justify-center gap-3 hover:bg-emerald-600 transition-all disabled:opacity-50"
          data-testid="demo-provider-btn"
        >
          {loading ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <>
              Увійти як майстер
              <ArrowRight className="w-5 h-5" />
            </>
          )}
        </button>

        <p className="text-muted-foreground text-sm mt-4">
          Демо-режим для тестування
        </p>
      </div>

      {/* Footer */}
      <div className="p-6 text-center border-t border-border">
        <p className="text-muted-foreground text-sm">Автомаркет © 2026</p>
      </div>
    </div>
  );
};

export default ProviderAuth;
