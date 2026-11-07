export type NavigationEntryKind = 'page' | 'project';

export function getHeaderLabels(active: string, entryKind?: NavigationEntryKind) {
  return {
    breadcrumb: entryKind
      ? entryKind === 'project' ? 'پروژه‌ها' : 'صفحه‌ها'
      : active === 'settings' ? 'تنظیمات' : active === 'publish' ? 'انتشار' : 'نمای کلی',
    title: entryKind
      ? undefined
      : active === 'settings' ? 'اطلاعات سایت' : active === 'publish' ? 'انتشار وب‌سایت' : 'فضای شما، روایت شما.',
  };
}
