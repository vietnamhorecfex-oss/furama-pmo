import { createContext, useContext, useState, type ReactNode } from 'react';

export type Lang = 'vi' | 'en';

const vi = {
  // Nav tabs
  dashboard: 'Dashboard', tasks: 'Công việc', board: 'Bảng Kanban',
  budget: 'Ngân sách', gates: 'Cột mốc', activity: 'Hoạt động',
  team: 'Thành viên', settings: 'Cài đặt', io: 'Nhập / Xuất',
  ai: 'AI Copilot', calendar: 'Lịch',
  // Header
  signOut: 'Đăng xuất', selectProject: 'Chọn dự án…',
  notifications: 'Thông báo', markAllRead: 'Đánh dấu đã đọc',
  noNotifications: 'Không có thông báo mới', language: 'Ngôn ngữ',
  // Board
  notStarted: 'Chưa bắt đầu', inProgress: 'Đang thực hiện',
  inReview: 'Đang xem xét', blocked: 'Bị chặn', completed: 'Hoàn thành',
  dropHere: 'Thả vào đây', boardTruncated: 'Hiển thị 500 task đầu. Dùng tab Công việc để lọc chi tiết.',
  syncing: 'Đang đồng bộ…', synced: 'Đã đồng bộ',
  // Calendar
  calendarTitle: 'Lịch tiến độ', today: 'Hôm nay', noTasks: 'Không có task',
  // AI translate
  translateContent: 'Dịch nội dung (AI)', translating: 'Đang dịch…',
  translatePlaceholder: 'Nhập nội dung cần dịch hoặc chọn ngôn ngữ đích…',
  // Common
  loading: 'Đang tải…', error: 'Lỗi', save: 'Lưu', cancel: 'Hủy', confirm: 'Xác nhận',
  noneYet: 'Chưa có dữ liệu',
};

const en: typeof vi = {
  dashboard: 'Dashboard', tasks: 'Tasks', board: 'Board',
  budget: 'Budget', gates: 'Gates', activity: 'Activity',
  team: 'Team', settings: 'Settings', io: 'Import / Export',
  ai: 'AI Copilot', calendar: 'Calendar',
  signOut: 'Sign out', selectProject: 'Select a project…',
  notifications: 'Notifications', markAllRead: 'Mark all read',
  noNotifications: 'No new notifications', language: 'Language',
  notStarted: 'Not started', inProgress: 'In progress',
  inReview: 'In review', blocked: 'Blocked', completed: 'Completed',
  dropHere: 'Drop here', boardTruncated: 'Showing first 500 tasks. Use Tasks tab for full filtering.',
  syncing: 'Syncing…', synced: 'Live',
  calendarTitle: 'Project Calendar', today: 'Today', noTasks: 'No tasks',
  translateContent: 'Translate (AI)', translating: 'Translating…',
  translatePlaceholder: 'Enter text to translate or select target language…',
  loading: 'Loading…', error: 'Error', save: 'Save', cancel: 'Cancel', confirm: 'Confirm',
  noneYet: 'Nothing here yet',
};

const TRANSLATIONS = { vi, en } as const;
export type Translations = typeof vi;

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: Translations;
}

const I18nContext = createContext<I18nCtx>({ lang: 'vi', setLang: () => {}, t: vi });

export function I18nProvider({ children }: { children: ReactNode }) {
  const stored = (typeof localStorage !== 'undefined' ? localStorage.getItem('furama_lang') : null) as Lang | null;
  const [lang, setLangState] = useState<Lang>(stored ?? 'vi');

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem('furama_lang', l);
  }

  return (
    <I18nContext.Provider value={{ lang, setLang, t: TRANSLATIONS[lang] }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
