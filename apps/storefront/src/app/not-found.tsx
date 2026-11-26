import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="not-found">
      <span className="not-found-mark">М</span>
      <span className="store-eyebrow">СТРАНИЦА НЕ НАЙДЕНА</span>
      <h1>Похоже, этой витрины пока нет.</h1>
      <p>Проверьте адрес или вернитесь на главную страницу Мастерской.</p>
      <Link className="platform-cta" href="/">
        На главную <span>→</span>
      </Link>
    </main>
  );
}
