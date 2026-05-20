/**
 * Lightweight i18n layer for the Expo app.
 *
 * - Two languages: en (default) + ru.
 * - Choice persisted in AsyncStorage under `atlas_lang`.
 * - When the user is authenticated, the choice is also pushed to the backend
 *   (`PATCH /account/me { language }`) so the same preference follows the
 *   account across devices.
 * - Components subscribe via `useT()` which returns:
 *     { t, lang, setLang, langs }
 *   `t('key')` returns the translated string for the current language with a
 *   safe fallback to English (and finally the key itself).
 *
 * The dictionary is intentionally compact — a "lite" pass covering the most
 * visible UX surfaces: profile screens, settings, common buttons. Adding new
 * strings is a 1-line edit per language; missing keys fall back gracefully.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api from './api';

export type LangCode = 'en' | 'ru';

export const LANGS: { code: LangCode; label: string; native: string }[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
];

export const STORAGE_KEY = 'atlas_lang';

type Dict = Record<string, string>;

const EN: Dict = {
  // Generic
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.retry': 'Retry',
  'common.loading': 'Loading…',
  'common.coming_soon': 'Coming soon',
  'common.ok': 'OK',
  'common.dev_mode': 'DEV mode',

  // Profile
  'profile.title': 'Profile',
  'profile.you': 'You',
  'profile.role.client': 'Client',
  'profile.role.developer': 'Developer',
  'profile.role.admin': 'Admin',
  'profile.section.account': 'Account',
  'profile.section.support': 'Support',
  'profile.section.workspace': 'Workspace',
  'profile.section.roles': 'Roles',
  'profile.section.actions': 'Actions',
  'profile.section.insights': 'Developer insights',
  'profile.section.wallet': 'Wallet',
  'profile.row.account_details': 'Account details',
  'profile.row.referrals': 'Referrals',
  'profile.row.referrals_earn': 'Referrals — earn 7%',
  'profile.row.documents': 'Documents',
  'profile.row.support': 'Help & support',
  'profile.row.switch_role': 'Switch role',
  'profile.row.settings': 'Settings',
  'profile.row.time_logs': 'Time logs',
  'profile.row.time_logs_sub': 'Hours across your tasks',
  'profile.row.leaderboard': 'Leaderboard',
  'profile.row.leaderboard_sub': 'Where you stand among developers',
  'profile.row.growth': 'Growth',
  'profile.row.growth_sub': 'How close you are to the next tier',
  'profile.row.projects': 'My projects',
  'profile.row.work': 'My work',
  'profile.row.admin': 'Control center',
  'profile.row.billing': 'Billing & payments',
  'profile.stats.projects': 'Projects',
  'profile.stats.invested': 'Invested',
  'profile.stats.member': 'Member',
  'profile.stats.building': 'BUILDING',
  'profile.stats.earned': 'EARNED',
  'profile.stats.roles': 'ROLES',
  'profile.signout': 'Sign out',
  'profile.signout_confirm': 'Sign out of admin session?',
  'profile.signout_action': 'Logout',
  'profile.empty.title': 'Pick how you show up',
  'profile.empty.sub': 'Start a project or join as a developer — you choose.',
  'profile.empty.cta': 'Go to Home',
  'profile.wallet.available': 'Available',
  'profile.wallet.pending': 'pending',
  'profile.wallet.withdraw': 'Withdraw',
  'profile.role.current': 'Current view',
  'profile.role.switch_to': 'Switch to',
  'profile.role.also_have': 'You also have access as',

  // Settings
  'settings.title': 'Settings',
  'settings.section.identity': 'Identity',
  'settings.section.security': 'Security',
  'settings.section.appearance': 'Appearance',
  'settings.section.account': 'Account',
  'settings.edit_profile': 'Edit name & avatar',
  'settings.signin_method': 'Sign-in method',
  'settings.signin_value': 'Email · OTP code',
  'settings.twofa': 'Two-factor auth',
  'settings.twofa_on': 'Two-factor authentication enabled.',
  'settings.twofa_off': 'Two-factor authentication disabled.',
  'settings.twofa_disable_title': 'Disable 2FA',
  'settings.twofa_disable_msg': 'Enter your 6-digit authenticator code, or a recovery code (XXXXX-XXXXX).',
  'settings.change_email': 'Change email',
  'settings.theme': 'Theme',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.theme.light_saved': 'Light theme rendering will arrive in the next release. Your preference is saved.',
  'settings.language': 'Language',
  'settings.language_saved': 'Language preference saved.',
  'settings.export_data': 'Export my data',
  'settings.export_msg': 'Your data will be emailed to you within 24h.',
  'settings.export_ok': 'Your data file has been downloaded.',
  'settings.delete_account': 'Delete account',
  'settings.delete_msg': 'Account deletion requires support to confirm pending payouts and active contracts. Reach out to support@atlas.dev.',
  'settings.version': 'ATLAS DevOS · v1.0',

  // Errors
  'error.generic': 'Something went wrong',
  'error.switch': 'Switch failed',
  'error.copy': 'Copy failed',
};

const RU: Dict = {
  // Generic
  'common.save': 'Сохранить',
  'common.cancel': 'Отмена',
  'common.retry': 'Повторить',
  'common.loading': 'Загрузка…',
  'common.coming_soon': 'Скоро',
  'common.ok': 'OK',
  'common.dev_mode': 'DEV режим',

  // Profile
  'profile.title': 'Профиль',
  'profile.you': 'Вы',
  'profile.role.client': 'Клиент',
  'profile.role.developer': 'Разработчик',
  'profile.role.admin': 'Админ',
  'profile.section.account': 'Аккаунт',
  'profile.section.support': 'Поддержка',
  'profile.section.workspace': 'Рабочее пространство',
  'profile.section.roles': 'Роли',
  'profile.section.actions': 'Действия',
  'profile.section.insights': 'Аналитика разработчика',
  'profile.section.wallet': 'Кошелёк',
  'profile.row.account_details': 'Данные аккаунта',
  'profile.row.referrals': 'Рефералы',
  'profile.row.referrals_earn': 'Рефералы — зарабатывайте 7%',
  'profile.row.documents': 'Документы',
  'profile.row.support': 'Помощь и поддержка',
  'profile.row.switch_role': 'Сменить роль',
  'profile.row.settings': 'Настройки',
  'profile.row.time_logs': 'Учёт времени',
  'profile.row.time_logs_sub': 'Часы по вашим задачам',
  'profile.row.leaderboard': 'Рейтинг',
  'profile.row.leaderboard_sub': 'Ваше место среди разработчиков',
  'profile.row.growth': 'Развитие',
  'profile.row.growth_sub': 'Насколько вы близки к следующему уровню',
  'profile.row.projects': 'Мои проекты',
  'profile.row.work': 'Мои задачи',
  'profile.row.admin': 'Центр управления',
  'profile.row.billing': 'Биллинг и платежи',
  'profile.stats.projects': 'Проекты',
  'profile.stats.invested': 'Инвестировано',
  'profile.stats.member': 'С нами с',
  'profile.stats.building': 'В РАБОТЕ',
  'profile.stats.earned': 'ЗАРАБОТАНО',
  'profile.stats.roles': 'РОЛЕЙ',
  'profile.signout': 'Выйти',
  'profile.signout_confirm': 'Выйти из сессии администратора?',
  'profile.signout_action': 'Выйти',
  'profile.empty.title': 'Выберите, кто вы',
  'profile.empty.sub': 'Запустите проект или присоединитесь как разработчик — выбор за вами.',
  'profile.empty.cta': 'На главную',
  'profile.wallet.available': 'Доступно',
  'profile.wallet.pending': 'в ожидании',
  'profile.wallet.withdraw': 'Вывести',
  'profile.role.current': 'Текущее представление',
  'profile.role.switch_to': 'Переключиться на',
  'profile.role.also_have': 'У вас также есть доступ как',

  // Settings
  'settings.title': 'Настройки',
  'settings.section.identity': 'Идентификация',
  'settings.section.security': 'Безопасность',
  'settings.section.appearance': 'Внешний вид',
  'settings.section.account': 'Аккаунт',
  'settings.edit_profile': 'Изменить имя и аватар',
  'settings.signin_method': 'Способ входа',
  'settings.signin_value': 'Email · код OTP',
  'settings.twofa': 'Двухфакторная авторизация',
  'settings.twofa_on': 'Двухфакторная авторизация включена.',
  'settings.twofa_off': 'Двухфакторная авторизация отключена.',
  'settings.twofa_disable_title': 'Отключить 2FA',
  'settings.twofa_disable_msg': 'Введите 6-значный код из приложения-аутентификатора или recovery-код (XXXXX-XXXXX).',
  'settings.change_email': 'Сменить email',
  'settings.theme': 'Тема',
  'settings.theme.dark': 'Тёмная',
  'settings.theme.light': 'Светлая',
  'settings.theme.light_saved': 'Светлая тема появится в следующем релизе. Выбор сохранён.',
  'settings.language': 'Язык',
  'settings.language_saved': 'Выбор языка сохранён.',
  'settings.export_data': 'Экспорт моих данных',
  'settings.export_msg': 'Ваши данные будут отправлены на email в течение 24 часов.',
  'settings.export_ok': 'Файл с вашими данными загружен.',
  'settings.delete_account': 'Удалить аккаунт',
  'settings.delete_msg': 'Удаление требует подтверждения от поддержки (выплаты, активные контракты). Напишите на support@atlas.dev.',
  'settings.version': 'ATLAS DevOS · v1.0',

  // Errors
  'error.generic': 'Что-то пошло не так',
  'error.switch': 'Не удалось переключиться',
  'error.copy': 'Не удалось скопировать',
};

const DICTS: Record<LangCode, Dict> = { en: EN, ru: RU };

type I18nCtx = {
  lang: LangCode;
  setLang: (next: LangCode, opts?: { syncBackend?: boolean }) => Promise<void>;
  t: (key: string, fallback?: string) => string;
  langs: typeof LANGS;
};

const I18nContext = createContext<I18nCtx>({
  lang: 'en',
  setLang: async () => {},
  t: (k, fb) => fb || k,
  langs: LANGS,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>('en');

  // Hydrate from AsyncStorage on mount.
  useEffect(() => {
    (async () => {
      try {
        const v = await AsyncStorage.getItem(STORAGE_KEY);
        if (v === 'en' || v === 'ru') setLangState(v);
      } catch {/* ignore */}
    })();
  }, []);

  const setLang = useCallback(async (next: LangCode, opts?: { syncBackend?: boolean }) => {
    setLangState(next);
    try { await AsyncStorage.setItem(STORAGE_KEY, next); } catch {/* ignore */}
    if (opts?.syncBackend !== false) {
      // Best-effort: push preference to backend so it follows the account.
      try { await api.patch('/account/me', { language: next }); } catch {/* unauth or not yet wired — fine */}
    }
  }, []);

  const t = useCallback((key: string, fallback?: string) => {
    const dict = DICTS[lang] || EN;
    return dict[key] ?? EN[key] ?? fallback ?? key;
  }, [lang]);

  const value = useMemo<I18nCtx>(() => ({ lang, setLang, t, langs: LANGS }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  return useContext(I18nContext);
}
