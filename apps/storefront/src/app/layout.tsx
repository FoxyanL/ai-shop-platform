import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Мастерская — конструктор интернет-магазинов', template: '%s · Мастерская' },
  description:
    'Создайте свой интернет-магазин, настройте витрину и управляйте каталогом в одном рабочем пространстве.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
