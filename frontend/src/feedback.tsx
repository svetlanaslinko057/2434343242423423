import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import T from './theme';

type Toast = { id: string; type: 'success' | 'warning' | 'error' | 'info'; title: string; subtitle?: string; icon?: string };
type FeedbackCtx = { show: (t: Omit<Toast, 'id'>) => void };

const FeedbackContext = createContext<FeedbackCtx>({ show: () => {} });
export const useFeedback = () => useContext(FeedbackContext);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<(Toast & { anim: Animated.Value })[]>([]);
  const counter = useRef(0);

  const show = useCallback((t: Omit<Toast, 'id'>) => {
    const id = String(++counter.current);
    const anim = new Animated.Value(0);
    const toast = { ...t, id, anim };
    setToasts(prev => [...prev, toast]);
    Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.delay(2500),
      Animated.timing(anim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => setToasts(prev => prev.filter(x => x.id !== id)));
  }, []);

  const colors = { success: T.success, warning: T.risk, error: T.danger, info: T.info };
  const icons: Record<string, string> = { success: 'checkmark-circle', warning: 'alert-circle', error: 'close-circle', info: 'information-circle' };

  return (
    <FeedbackContext.Provider value={{ show }}>
      {children}
      <View style={s.container} pointerEvents="box-none">
        {toasts.map(t => (
          <Animated.View key={t.id} style={[s.toast, { backgroundColor: colors[t.type] + '15', borderLeftColor: colors[t.type], opacity: t.anim, transform: [{ translateY: t.anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) }] }]}>
            <Ionicons name={(t.icon || icons[t.type]) as any} size={20} color={colors[t.type]} />
            <View style={s.toastContent}>
              <Text style={[s.toastTitle, { color: colors[t.type] }]}>{t.title}</Text>
              {t.subtitle && <Text style={s.toastSub}>{t.subtitle}</Text>}
            </View>
          </Animated.View>
        ))}
      </View>
    </FeedbackContext.Provider>
  );
}

const s = StyleSheet.create({
  container: { position: 'absolute', top: 50, left: 16, right: 16, zIndex: 9999, gap: 8 },
  toast: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 10, borderLeftWidth: 4, borderWidth: 1, borderColor: T.border, gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8 },
  toastContent: { flex: 1 },
  toastTitle: { fontSize: 14, fontWeight: '700' },
  toastSub: { color: T.textMuted, fontSize: 12, marginTop: 2 },
});
