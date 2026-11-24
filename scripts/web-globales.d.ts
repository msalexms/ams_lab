// Lo que la web tiene como global (para npm run tipos): la traducción de public/i18n.js, cargada antes que los módulos.
declare const I18N: {
  t(es: string, vars?: Record<string, unknown>): string;
  plural(n: number, uno: string): string;
  cat(id: string, nombre: string): string;
  fn(id: string, nombre: string): string;
  dif(nivel: number | string, nombre: string): string;
  set(lang: string): void;
  shell(): void;
  lang(): 'en' | 'es';
  loc(): string;
  EN: Record<string, string>;
};
interface Window { I18N: typeof I18N }
