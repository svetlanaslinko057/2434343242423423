import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import T from './theme';

type Props = {
  visible: boolean;
  title: string;
  consequences: string[];
  confirmLabel: string;
  confirmColor?: string;
  cancelLabel?: string;
  icon?: string;
  iconColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmModal({ visible, title, consequences, confirmLabel, confirmColor = T.primary, cancelLabel = 'Cancel', icon, iconColor, onConfirm, onCancel }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={s.overlay}>
        <View style={s.card}>
          {icon && (
            <View style={[s.iconWrap, { backgroundColor: (iconColor || confirmColor) + '15' }]}>
              <Ionicons name={icon as any} size={32} color={iconColor || confirmColor} />
            </View>
          )}
          <Text style={s.title}>{title}</Text>
          <View style={s.consequences}>
            <Text style={s.consLabel}>This will:</Text>
            {consequences.map((c, i) => (
              <View key={i} style={s.consRow}>
                <Ionicons name="arrow-forward" size={14} color={T.textMuted} />
                <Text style={s.consText}>{c}</Text>
              </View>
            ))}
          </View>
          <View style={s.buttons}>
            <TouchableOpacity testID="confirm-modal-cancel" style={s.cancelBtn} onPress={onCancel}>
              <Text style={s.cancelText}>{cancelLabel}</Text>
            </TouchableOpacity>
            <TouchableOpacity testID="confirm-modal-confirm" style={[s.confirmBtn, { backgroundColor: confirmColor }]} onPress={onConfirm}>
              <Text style={s.confirmText}>{confirmLabel}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { backgroundColor: T.surface1, borderRadius: 16, padding: 24, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: T.border },
  iconWrap: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 16 },
  title: { color: T.text, fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 16 },
  consequences: { backgroundColor: T.surface2, borderRadius: 10, padding: 14, marginBottom: 20 },
  consLabel: { color: T.textMuted, fontSize: 12, fontWeight: '600', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' },
  consRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  consText: { color: T.text, fontSize: 14 },
  buttons: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, borderRadius: 10, padding: 14, alignItems: 'center', backgroundColor: T.surface2, borderWidth: 1, borderColor: T.border },
  cancelText: { color: T.textMuted, fontWeight: '600', fontSize: 15 },
  confirmBtn: { flex: 1, borderRadius: 10, padding: 14, alignItems: 'center' },
  confirmText: { color: T.bg, fontWeight: '700', fontSize: 15 },
});
