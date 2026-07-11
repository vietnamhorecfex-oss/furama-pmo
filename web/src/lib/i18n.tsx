'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

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
  // Gates / milestones
  milestonesTitle: 'Cột mốc & Cổng', autoFromPhases: 'Tự động tạo từ Phase',
  generatingMilestones: 'Đang tạo…', noMilestones: 'Chưa có cột mốc',
  readinessLabel: 'Mức sẵn sàng', tasksComplete: 'task hoàn thành',
  milestonesGenerated: 'Đã tạo {c} mới, cập nhật {u} cột mốc từ phase',
  // Calendar
  calendarTitle: 'Lịch tiến độ', today: 'Hôm nay', noTasks: 'Không có task',
  // AI translate
  translateContent: 'Dịch nội dung (AI)', translating: 'Đang dịch…',
  translatePlaceholder: 'Nhập nội dung cần dịch hoặc chọn ngôn ngữ đích…',
  // Task drawer — progress + history
  updateProgress: 'Cập nhật tiến độ', statusLabel: 'Trạng thái', percentLabel: 'Tiến độ (%)',
  progressNote: 'Ghi chú cập nhật', progressNotePlaceholder: 'Mô tả thay đổi (tùy chọn)…',
  saveProgress: 'Lưu cập nhật', savingProgress: 'Đang lưu…',
  history: 'Lịch sử cập nhật', noHistory: 'Chưa có lịch sử', note: 'Ghi chú',
  taskBudgetTitle: 'Ngân sách công việc', budgetAllocated: 'Ngân sách phân bổ',
  linkedCategory: 'Hạng mục Budget', rollupHint: 'Cộng vào Committed ở mục Budget',
  inCharge: 'Phụ trách', support: 'Hỗ trợ', description: 'Mô tả', comments: 'Bình luận',
  addComment: 'Thêm bình luận…', postComment: 'Gửi bình luận', posting: 'Đang gửi…',
  noComments: 'Chưa có bình luận', created: 'Tạo mới', updated: 'Cập nhật',
  // Budget dashboard
  projectTotals: 'Tổng quan ngân sách', cap: 'Trần (CAP)', planned: 'Kế hoạch',
  committed: 'Cam kết', actual: 'Thực chi', remaining: 'Còn lại',
  capUtilization: 'Mức sử dụng trần', headroom: 'Dự phòng', ofCap: 'của CAP',
  byCategory: 'Theo hạng mục', byWorkstream: 'Theo nhóm công việc',
  overrun: 'Vượt KH', overCapWarn: 'Cam kết vượt trần', overCapBy: 'Vượt trần',
  noCategoriesConfigured: 'Chưa cấu hình hạng mục ngân sách', noSpendYet: 'Chưa ghi nhận chi phí',
  searchCategory: 'Tìm hạng mục…', showAll: 'Xem tất cả', showLess: 'Thu gọn',
  ofTotal: 'của tổng', onBudget: 'Đúng kế hoạch', overrunsTitle: 'Cảnh báo vượt kế hoạch',
  noOverruns: 'Không có hạng mục nào vượt kế hoạch', categories: 'hạng mục',
  exportExcel: 'Xuất Excel', importExcel: 'Nhập Excel', importingBudget: 'Đang nhập…',
  editCap: 'Sửa trần', editPlanned: 'Sửa kế hoạch', budgetSaved: 'Đã lưu',
  budgetImportedMsg: 'Đã nhập: {u} cập nhật, {c} tạo mới', importHint: 'Chọn file CSV (cột Category, Planned)',
  // Tasks table columns + filters
  colCode: 'Mã', colTitle: 'Công việc', colDept: 'Bộ phận', colPic: 'Phụ trách (PIC)',
  colStart: 'Bắt đầu', colDeadline: 'Hạn chót', colPriority: 'Ưu tiên',
  colStatus: 'Trạng thái', colPercent: '%', colHealth: 'Tiến độ',
  searchTasks: 'Tìm mã / tên / mô tả', allStatuses: 'Tất cả trạng thái',
  allPriorities: 'Tất cả ưu tiên', allDepartments: 'Tất cả bộ phận', allHealth: 'Tất cả tiến độ',
  sortBy: 'Sắp xếp', sortStart: 'Ngày bắt đầu', sortDeadline: 'Hạn chót', sortCode: 'Mã',
  sortPercent: '% tiến độ', sortPriority: 'Ưu tiên', sortUpdated: 'Cập nhật gần đây',
  asc: 'Tăng dần', desc: 'Giảm dần', noTasksMatch: 'Không có công việc phù hợp',
  tasksCount: 'công việc', page: 'Trang', prev: 'Trước', next: 'Sau', resetFilters: 'Xóa lọc',
  // Schedule health
  healthDone: 'Hoàn thành', healthAhead: 'Nhanh', healthOnTrack: 'Đúng tiến độ',
  healthBehind: 'Chậm', healthOverdue: 'Trễ hạn', healthNone: 'Chưa có hạn',
  // Team & permissions
  teamTitle: 'Đội ngũ & phân quyền', teamSubtitle: 'Người tham gia dự án',
  daysToOpeningLabel: 'ngày đến Khai trương', addUser: 'Thêm người dùng', you: 'bạn',
  edit: 'Sửa', remove: 'Xóa', inTaskAs: 'Tên trong task', taskUnit: 'task',
  wsScope: 'Dự án', permissionsByRole: 'Quyền hạn theo vai trò', noMembers: 'Chưa có thành viên',
  removeMemberConfirm: 'Xóa thành viên này khỏi dự án?', editMember: 'Sửa thành viên', addMember: 'Thêm thành viên',
  userIdLabel: 'Người dùng', roleLabel: 'Vai trò', memberLabelField: 'Tên hiển thị trong task',
  selectUser: '— Chọn người dùng —', noAvailableUsers: 'Tất cả người dùng đã là thành viên',
  existingUserTab: 'Người dùng có sẵn', newUserTab: 'Tạo mới',
  nameLabel: 'Họ tên', emailLabel: 'Email', createUser: 'Tạo người dùng',
  userCreatedTitle: 'Đã tạo người dùng', userCreatedHint: 'Sao chép mật khẩu bên dưới và gửi cho nhân viên — mật khẩu chỉ hiển thị một lần.',
  passwordLabel: 'Mật khẩu', copy: 'Sao chép', copied: 'Đã sao chép', done: 'Xong',
  wsScopeHint: 'Phạm vi workstream (chỉ cho Workstream Lead)', adding: 'Đang thêm…', saving: 'Đang lưu…',
  permView: 'Xem', permProgress: 'Cập nhật tiến độ', permEditTask: 'Sửa/Thêm task',
  permDeleteTask: 'Xóa task', permManageUsers: 'Quản lý người dùng', permConfig: 'Cấu hình',
  permAll: 'tất cả', permOwn: 'dự án mình', permAssigned: 'task được giao',
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
  milestonesTitle: 'Milestones & Gates', autoFromPhases: 'Auto-generate from phases',
  generatingMilestones: 'Generating…', noMilestones: 'No milestones yet',
  readinessLabel: 'Readiness', tasksComplete: 'tasks complete',
  milestonesGenerated: 'Created {c}, updated {u} milestones from phases',
  calendarTitle: 'Project Calendar', today: 'Today', noTasks: 'No tasks',
  translateContent: 'Translate (AI)', translating: 'Translating…',
  translatePlaceholder: 'Enter text to translate or select target language…',
  updateProgress: 'Update progress', statusLabel: 'Status', percentLabel: 'Progress (%)',
  progressNote: 'Update note', progressNotePlaceholder: 'Describe the change (optional)…',
  saveProgress: 'Save update', savingProgress: 'Saving…',
  history: 'Update history', noHistory: 'No history yet', note: 'Note',
  taskBudgetTitle: 'Task budget', budgetAllocated: 'Allocated budget',
  linkedCategory: 'Budget category', rollupHint: 'Adds to Committed in the Budget tab',
  inCharge: 'In charge', support: 'Support', description: 'Description', comments: 'Comments',
  addComment: 'Add a comment…', postComment: 'Post comment', posting: 'Posting…',
  noComments: 'No comments yet', created: 'Created', updated: 'Updated',
  projectTotals: 'Budget overview', cap: 'Cap', planned: 'Planned',
  committed: 'Committed', actual: 'Actual', remaining: 'Remaining',
  capUtilization: 'Cap utilization', headroom: 'Headroom', ofCap: 'of cap',
  byCategory: 'By category', byWorkstream: 'By workstream',
  overrun: 'Overrun', overCapWarn: 'Committed exceeds cap', overCapBy: 'Over cap by',
  noCategoriesConfigured: 'No budget categories configured', noSpendYet: 'No spend tracked yet',
  searchCategory: 'Search category…', showAll: 'Show all', showLess: 'Show less',
  ofTotal: 'of total', onBudget: 'On budget', overrunsTitle: 'Overrun alerts',
  noOverruns: 'No categories over plan', categories: 'categories',
  exportExcel: 'Export Excel', importExcel: 'Import Excel', importingBudget: 'Importing…',
  editCap: 'Edit cap', editPlanned: 'Edit planned', budgetSaved: 'Saved',
  budgetImportedMsg: 'Imported: {u} updated, {c} created', importHint: 'Pick a CSV (Category, Planned columns)',
  colCode: 'Code', colTitle: 'Title', colDept: 'Dept', colPic: 'In charge (PIC)',
  colStart: 'Start', colDeadline: 'Deadline', colPriority: 'Priority',
  colStatus: 'Status', colPercent: '%', colHealth: 'Progress',
  searchTasks: 'Search code / title / description', allStatuses: 'All statuses',
  allPriorities: 'All priorities', allDepartments: 'All departments', allHealth: 'All progress',
  sortBy: 'Sort by', sortStart: 'Start date', sortDeadline: 'Deadline', sortCode: 'Code',
  sortPercent: 'Progress %', sortPriority: 'Priority', sortUpdated: 'Recently updated',
  asc: 'Ascending', desc: 'Descending', noTasksMatch: 'No tasks match',
  tasksCount: 'tasks', page: 'Page', prev: 'Prev', next: 'Next', resetFilters: 'Clear',
  healthDone: 'Done', healthAhead: 'Ahead', healthOnTrack: 'On track',
  healthBehind: 'Behind', healthOverdue: 'Overdue', healthNone: 'No deadline',
  teamTitle: 'Team & permissions', teamSubtitle: 'Project members',
  daysToOpeningLabel: 'days to opening', addUser: 'Add user', you: 'you',
  edit: 'Edit', remove: 'Remove', inTaskAs: 'Task label', taskUnit: 'tasks',
  wsScope: 'Workstream', permissionsByRole: 'Permissions by role', noMembers: 'No members yet',
  removeMemberConfirm: 'Remove this member from the project?', editMember: 'Edit member', addMember: 'Add member',
  userIdLabel: 'User', roleLabel: 'Role', memberLabelField: 'Task display label',
  selectUser: '— Select a user —', noAvailableUsers: 'All users are already members',
  existingUserTab: 'Existing user', newUserTab: 'Create new',
  nameLabel: 'Full name', emailLabel: 'Email', createUser: 'Create user',
  userCreatedTitle: 'User created', userCreatedHint: 'Copy the password below and send it to the user — it is shown only once.',
  passwordLabel: 'Password', copy: 'Copy', copied: 'Copied', done: 'Done',
  wsScopeHint: 'Workstream scope (Workstream Lead only)', adding: 'Adding…', saving: 'Saving…',
  permView: 'View', permProgress: 'Update progress', permEditTask: 'Edit/Add task',
  permDeleteTask: 'Delete task', permManageUsers: 'Manage users', permConfig: 'Config',
  permAll: 'all', permOwn: 'own workstream', permAssigned: 'assigned tasks',
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
  // Start from 'vi' on both server and first client render so hydration matches. The persisted
  // preference is read AFTER mount — reading localStorage during render caused a guaranteed
  // hydration mismatch (SSR has no localStorage) for every user whose stored language is 'en'.
  const [lang, setLangState] = useState<Lang>('vi');

  useEffect(() => {
    const stored = (typeof localStorage !== 'undefined' ? localStorage.getItem('furama_lang') : null) as Lang | null;
    if (stored === 'en' || stored === 'vi') setLangState(stored);
  }, []);

  function setLang(l: Lang) {
    setLangState(l);
    if (typeof localStorage !== 'undefined') localStorage.setItem('furama_lang', l);
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
