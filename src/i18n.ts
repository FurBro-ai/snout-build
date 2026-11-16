import { useSyncExternalStore } from 'react';

export type Locale = 'en' | 'ru';

const STORAGE_KEY = 'snout_locale_v1';
const strings = {
  en: {
    settings: 'User Settings', profile: 'Profile & Customization', appearance: 'Appearance & Language',
    security: 'Account & 2FA Security', sessions: 'Active Sessions', signOut: 'Sign Out',
    language: 'Language', themes: 'Themes', themeDescription: 'Changes apply immediately and stay on this device.',
    resetTheme: 'Reset to default theme', themeName: 'Theme name', advancedColors: 'Advanced colors',
    mode: 'Mode', dark: 'Dark', light: 'Light', density: 'Density', radius: 'Corner radius',
    saveTheme: 'Save custom theme', savedTheme: 'Custom theme saved.', importedTheme: 'Theme imported.',
    custom: 'Custom', importTheme: 'Import theme', exportTheme: 'Export theme',
    findJump: 'Find or jump to...', events: 'Events', create: 'Create', cancel: 'Cancel',
    friends: 'Friends', directMessages: 'Direct Messages', noConversations: 'No conversations yet. Add a friend or start a Group DM.',
    voiceConnected: 'Voice Connected', disconnectVoice: 'Disconnect Voice', camera: 'Camera',
    invitePeople: 'Invite People', createCategory: 'Create Category', leaveServer: 'Leave Server',
  },
  ru: {
    settings: 'Настройки пользователя', profile: 'Профиль и оформление', appearance: 'Внешний вид и язык',
    security: 'Аккаунт и двухфакторная защита', sessions: 'Активные сеансы', signOut: 'Выйти',
    language: 'Язык', themes: 'Темы', themeDescription: 'Изменения применяются сразу и сохраняются на этом устройстве.',
    resetTheme: 'Сбросить тему', themeName: 'Название темы', advancedColors: 'Дополнительные цвета',
    mode: 'Режим', dark: 'Тёмный', light: 'Светлый', density: 'Плотность', radius: 'Скругление углов',
    saveTheme: 'Сохранить тему', savedTheme: 'Тема сохранена.', importedTheme: 'Тема импортирована.',
    custom: 'Своя тема', importTheme: 'Импорт темы', exportTheme: 'Экспорт темы',
    findJump: 'Найти или перейти...', events: 'События', create: 'Создать', cancel: 'Отмена',
    friends: 'Друзья', directMessages: 'Личные сообщения', noConversations: 'Пока нет переписок. Добавьте друга или создайте групповой чат.',
    voiceConnected: 'Голосовое подключение', disconnectVoice: 'Отключиться', camera: 'Камера',
    invitePeople: 'Пригласить', createCategory: 'Создать категорию', leaveServer: 'Покинуть сервер',
  },
} as const;

export type TranslationKey = keyof typeof strings.en;
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === 'ru' ? 'ru' : 'en';
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  listeners.forEach((listener) => listener());
}

export function translate(key: TranslationKey, locale: Locale = getLocale()): string {
  return strings[locale][key];
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getLocale,
    () => 'en'
  );
}