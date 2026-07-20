import { useStore } from '../store';
import { t, Locale } from '../i18n';

export function useTranslation() {
  const locale = useStore((s) => s.config.locale || 'zh-CN');

  const translate = (key: string, params?: Record<string, string>) => {
    return t(key, params, locale);
  };

  return { t: translate, locale };
}
