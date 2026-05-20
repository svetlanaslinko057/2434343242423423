import React, { useRef, useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import T from './theme';

type StateChange = { label: string; before: string; after: string };

type ShiftData = {
  id: string;
  title: string;
  changes: StateChange[];
};

type StateShiftCtx = {
  showShift: (data: Omit<ShiftData, 'id'>) => void;
};

const StateShiftContext = React.createContext<StateShiftCtx>({ showShift: () => {} });
export const useStateShift = () => React.useContext(StateShiftContext);

export function StateShiftProvider({ children }: { children: React.ReactNode }) {
  const [shift, setShift] = useState<(ShiftData & { anim: Animated.Value }) | null>(null);
  const counter = useRef(0);

  const showShift = useCallback((data: Omit<ShiftData, 'id'>) => {
    const id = String(++counter.current);
    const anim = new Animated.Value(0);
    const s = { ...data, id, anim };
    setShift(s);
    Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.delay(5000),
      Animated.timing(anim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start(() => setShift(null));
  }, []);

  return (
    <StateShiftContext.Provider value={{ showShift }}>
      {children}
      {shift && (
        <Animated.View style={[s.overlay, { opacity: shift.anim, transform: [{ translateY: shift.anim.interpolate({ inputRange: [0, 1], outputRange: [50, 0] }) }] }]}>
          <View style={s.card}>
            <View style={s.header}>
              <Ionicons name="flash" size={16} color={T.success} />
              <Text style={s.headerText}>STATE CHANGED</Text>
              <TouchableOpacity onPress={() => setShift(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close" size={18} color={T.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={s.title}>{shift.title}</Text>
            {shift.changes.map((c, i) => (
              <View key={i} style={s.changeRow}>
                <Text style={s.changeLabel}>{c.label}</Text>
                <View style={s.changeVals}>
                  <Text style={s.beforeVal}>{c.before}</Text>
                  <Ionicons name="arrow-forward" size={12} color={T.success} />
                  <Text style={s.afterVal}>{c.after}</Text>
                </View>
              </View>
            ))}
          </View>
        </Animated.View>
      )}
    </StateShiftContext.Provider>
  );
}

const s = StyleSheet.create({
  overlay: { position: 'absolute', bottom: 80, left: 12, right: 12, zIndex: 9998 },
  card: { backgroundColor: T.surface1, borderRadius: T.radius, padding: T.md, borderWidth: 1, borderColor: T.successBorder, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: T.sm },
  headerText: { color: T.success, fontSize: 10, fontWeight: '800', letterSpacing: 2, flex: 1 },
  title: { color: T.text, fontSize: T.h3, fontWeight: '700', marginBottom: T.sm },
  changeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  changeLabel: { color: T.textMuted, fontSize: T.small, flex: 1 },
  changeVals: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  beforeVal: { color: T.danger, fontSize: T.small, fontWeight: '600', textDecorationLine: 'line-through', opacity: 0.7 },
  afterVal: { color: T.success, fontSize: T.small, fontWeight: '700' },
});
