import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:5173';
  return (
    <main className="platform-page">
      <nav className="platform-nav">
        <Link className="store-brand" href="/">
          <span>М</span> мастерская<i>.</i>
        </Link>
        <div>
          <a href="#how">Как это работает</a>
          <a href="#tools">Возможности</a>
        </div>
        <Link className="platform-login" href={adminUrl}>
          Войти в кабинет <span>↗</span>
        </Link>
      </nav>
      <section className="platform-hero">
        <div className="platform-copy">
          <span className="store-eyebrow">ВАША ИДЕЯ. ВАША ВИТРИНА.</span>
          <h1>
            Магазин, который
            <br />
            начинается с <em>вас.</em>
          </h1>
          <p>
            Создайте место для своего дела: соберите витрину, добавьте товары и откройте магазин
            покупателям.
          </p>
          <Link className="platform-cta" href={adminUrl}>
            Начать создавать <span>→</span>
          </Link>
          <div className="platform-proof">
            <span>
              <i>✓</i> Без кода
            </span>
            <span>
              <i>✓</i> Свой каталог
            </span>
            <span>
              <i>✓</i> Публикация в пару шагов
            </span>
          </div>
        </div>
        <div className="platform-art">
          <div className="platform-art-circle" />
          <div className="platform-mini-window">
            <div className="mini-head">
              <span />
              <span />
              <span />
              <i>мастерская.</i>
            </div>
            <div className="mini-copy">
              <small>АВТОРСКАЯ КЕРАМИКА</small>
              <strong>Вещи с характером</strong>
              <i>Каждая деталь — с заботой</i>
              <button>Смотреть каталог →</button>
            </div>
            <div className="mini-photo">
              <span />
              <b>✳</b>
            </div>
          </div>
          <span className="art-tag">ВАША МАСТЕРСКАЯ</span>
          <span className="art-flower">✳</span>
        </div>
      </section>
      <section className="platform-features" id="tools">
        <div>
          <span>01</span>
          <strong>Начните с шаблона</strong>
          <p>Выберите настроение и оформите первую версию своей витрины.</p>
        </div>
        <div>
          <span>02</span>
          <strong>Соберите каталог</strong>
          <p>Добавьте товары и разложите их по понятным покупателям категориям.</p>
        </div>
        <div>
          <span>03</span>
          <strong>Откройте магазин</strong>
          <p>Проверьте результат и опубликуйте страницу для своих клиентов.</p>
        </div>
      </section>
      <footer className="platform-footer" id="how">
        <span>Мастерская — место для малого дела.</span>
        <span>Платформа находится в разработке · 2026</span>
      </footer>
    </main>
  );
}
