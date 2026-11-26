'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type { ShopPageData } from './page';

type BasketItem = {
  id: string | number;
  goodId: string | number;
  count: number;
  name: string;
  price: string | number;
  stockCount: number;
  lineTotal: string | number;
};
type AuthResult = { accessToken: string; user: { id: string; email: string; role: string } };

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';

async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string; retry?: boolean } = {},
): Promise<T> {
  const token =
    options.token ??
    (typeof window !== 'undefined'
      ? (sessionStorage.getItem('accessToken') ?? undefined)
      : undefined);
  const headers = new Headers();
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (response.status === 401 && token && options.retry !== false) {
    const refreshed = await api<{ accessToken: string }>('/auth/refresh', {
      method: 'POST',
      retry: false,
    });
    sessionStorage.setItem('accessToken', refreshed.accessToken);
    return api<T>(path, { ...options, token: refreshed.accessToken, retry: false });
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Не удалось выполнить запрос (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function ShopExperience({
  shop,
  accent,
  heroTitle,
  heroText,
}: {
  shop: ShopPageData;
  accent: string;
  heroTitle: string;
  heroText: string;
}) {
  const [basket, setBasket] = useState<BasketItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'closed' | 'email' | 'code'>('closed');
  const [signup, setSignup] = useState(true);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [otp, setOtp] = useState('');
  const [debugCode, setDebugCode] = useState('');
  const [pendingGood, setPendingGood] = useState<string | number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [recipient, setRecipient] = useState({
    firstName: '',
    lastName: '',
    address: '',
    zipCode: '',
    phone: '',
  });
  const [paymentId, setPaymentId] = useState(String(shop.paymentMethods[0]?.id ?? ''));
  const [deliveryId, setDeliveryId] = useState(String(shop.deliveryMethods[0]?.id ?? ''));

  async function loadBasket() {
    const token = sessionStorage.getItem('accessToken');
    if (!token) return;
    const result = await api<{ items: BasketItem[] }>('/me/basket-items');
    setBasket(result.items);
  }

  useEffect(() => {
    if (sessionStorage.getItem('accessToken'))
      void loadBasket().catch(() => sessionStorage.removeItem('accessToken'));
  }, []);

  async function addGood(goodId: string | number) {
    setError('');
    setNotice('');
    const token = sessionStorage.getItem('accessToken');
    if (!token) {
      setPendingGood(goodId);
      setAuthMode('email');
      setError('');
      return;
    }
    const existing = basket.find((item) => String(item.goodId) === String(goodId));
    try {
      await api('/me/basket-items', {
        method: 'POST',
        body: { goodId, count: (existing?.count ?? 0) + 1 },
      });
      await loadBasket();
      setNotice('Добавили в корзину.');
    } catch (requestError) {
      if (requestError instanceof Error && requestError.message.includes('авторизац')) {
        setPendingGood(goodId);
        setAuthMode('email');
        return;
      }
      setError(requestError instanceof Error ? requestError.message : 'Не удалось добавить товар');
    }
  }

  async function requestCode(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = signup
        ? await api<{ debugCode?: string }>('/auth/register', {
            method: 'POST',
            body: { email, firstName, lastName, role: 'customer' },
          })
        : await api<{ debugCode?: string }>('/auth/login', { method: 'POST', body: { email } });
      setDebugCode(result.debugCode ?? '');
      setAuthMode('code');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось отправить код');
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const session = await api<AuthResult>('/auth/confirm', {
        method: 'POST',
        body: { email, otp },
      });
      sessionStorage.setItem('accessToken', session.accessToken);
      setAuthMode('closed');
      setOtp('');
      await loadBasket();
      if (pendingGood !== null) await addGood(pendingGood);
      setPendingGood(null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось подтвердить код');
    } finally {
      setLoading(false);
    }
  }

  async function changeCount(item: BasketItem, amount: number) {
    const count = item.count + amount;
    if (count < 1) {
      await removeItem(item.id);
      return;
    }
    setError('');
    try {
      await api(`/me/basket-items/${item.id}`, { method: 'PATCH', body: { count } });
      await loadBasket();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Не удалось изменить количество',
      );
    }
  }

  async function removeItem(id: string | number) {
    setError('');
    try {
      await api(`/me/basket-items/${id}`, { method: 'DELETE' });
      await loadBasket();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось удалить товар');
    }
  }

  async function submitCheckout(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const savedRecipient = await api<{ id: string | number }>('/me/recipients', {
        method: 'POST',
        body: recipient,
      });
      const result = await api<{
        id: string;
        transaction: { id: string; status: string; amount: string };
      }>('/me/checkouts', {
        method: 'POST',
        body: {
          recipientId: savedRecipient.id,
          paymentMethodId: Number(paymentId),
          deliveryMethodId: Number(deliveryId),
        },
      });
      setBasket([]);
      setCheckoutOpen(false);
      setNotice(
        `Заказ ${result.id.slice(0, 8)} создан. Статус оплаты: ${result.transaction.status}.`,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось оформить заказ');
    } finally {
      setLoading(false);
    }
  }

  const total = basket.reduce((sum, item) => sum + Number(item.lineTotal), 0);
  const count = basket.reduce((sum, item) => sum + item.count, 0);

  return (
    <main
      className={`storefront-page template-${shop.template}`}
      style={{ '--shop-accent': accent } as React.CSSProperties}
    >
      <header className="storefront-header">
        <a className="store-brand" href={`/${shop.slug}`}>
          <span>М</span>
          {shop.title}
          <i>.</i>
        </a>
        <nav>
          <a href="#catalog">Каталог</a>
          <a href="#about">О магазине</a>
          <a href="#delivery">Доставка и оплата</a>
        </nav>
        <button
          className="store-cart"
          onClick={() => {
            setCartOpen(true);
            setNotice('');
          }}
          aria-label="Открыть корзину"
        >
          Сумка <span>{count}</span>
        </button>
      </header>
      {notice && (
        <div className="store-notice" role="status">
          {notice}
          <button onClick={() => setNotice('')} aria-label="Закрыть сообщение">
            ×
          </button>
        </div>
      )}
      <section className="storefront-hero">
        <div className="storefront-hero-copy">
          <span className="store-eyebrow">{shop.category || 'МАГАЗИН ДЛЯ ВАС'}</span>
          <h1>{heroTitle}</h1>
          <p>{heroText}</p>
          <a className="storefront-cta" href="#catalog">
            Смотреть каталог <span>→</span>
          </a>
        </div>
        <div className="storefront-hero-art">
          <span className="hero-circle" />
          <div className="hero-vase">
            <i />
            <b>✳</b>
          </div>
          <span className="hero-asterisk">✳</span>
        </div>
      </section>
      <section className="catalog-section" id="catalog">
        <div className="catalog-heading">
          <div>
            <span className="store-eyebrow">КОЛЛЕКЦИЯ МАГАЗИНА</span>
            <h2>Выбрали для вас</h2>
          </div>
          <span>
            {shop.goods.length} {shop.goods.length === 1 ? 'товар' : 'товаров'}
          </span>
        </div>
        {shop.goods.length ? (
          <div className="product-grid">
            {shop.goods.map((good, index) => (
              <article className="product-card" key={good.id}>
                <div className={`product-art product-art-${index % 4}`}>
                  <span>М</span>
                  <i>✳</i>
                </div>
                <div className="product-detail">
                  <div>
                    <h3>{good.name}</h3>
                    <p>{good.description || 'Скоро появится описание товара.'}</p>
                  </div>
                  <strong>{Number(good.price).toLocaleString('ru-RU')} ₽</strong>
                </div>
                <button className="product-add" onClick={() => void addGood(good.id)}>
                  Добавить в корзину <span>＋</span>
                </button>
              </article>
            ))}
          </div>
        ) : (
          <div className="catalog-empty">
            <span>✳</span>
            <h3>Скоро здесь появятся товары</h3>
            <p>Владелец магазина уже готовит каталог.</p>
          </div>
        )}
      </section>
      <section className="store-about" id="about">
        <span className="store-eyebrow">ЗДЕСЬ ЕСТЬ ИСТОРИЯ</span>
        <h2>{shop.title} — с вниманием к каждой детали.</h2>
        <p>{heroText}</p>
      </section>
      <footer className="storefront-footer" id="delivery">
        <a className="store-brand" href={`/${shop.slug}`}>
          <span>М</span>
          {shop.title}
          <i>.</i>
        </a>
        <span>Выберите удобный способ доставки и оплаты при оформлении заказа.</span>
        <small>Сайт создан в Мастерской</small>
      </footer>

      {cartOpen && (
        <div className="drawer-overlay" role="presentation" onClick={() => setCartOpen(false)}>
          <aside
            className="cart-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Корзина"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="drawer-header">
              <div>
                <span className="store-eyebrow">ВАШ ВЫБОР</span>
                <h2>
                  Корзина <span>{count}</span>
                </h2>
              </div>
              <button
                className="drawer-close"
                onClick={() => setCartOpen(false)}
                aria-label="Закрыть корзину"
              >
                ×
              </button>
            </div>
            {error && <div className="cart-error">{error}</div>}
            {basket.length ? (
              <>
                <div className="cart-items">
                  {basket.map((item) => (
                    <article className="cart-item" key={item.id}>
                      <div className="cart-product-art">М</div>
                      <div className="cart-item-body">
                        <strong>{item.name}</strong>
                        <span>{Number(item.price).toLocaleString('ru-RU')} ₽</span>
                        <div className="quantity-control">
                          <button
                            onClick={() => void changeCount(item, -1)}
                            aria-label="Уменьшить количество"
                          >
                            −
                          </button>
                          <span>{item.count}</span>
                          <button
                            onClick={() => void changeCount(item, 1)}
                            aria-label="Увеличить количество"
                          >
                            ＋
                          </button>
                          <button className="cart-remove" onClick={() => void removeItem(item.id)}>
                            Убрать
                          </button>
                        </div>
                      </div>
                      <strong>{Number(item.lineTotal).toLocaleString('ru-RU')} ₽</strong>
                    </article>
                  ))}
                </div>
                <div className="cart-total">
                  <span>Итого</span>
                  <strong>{total.toLocaleString('ru-RU')} ₽</strong>
                </div>
                {checkoutOpen ? (
                  <form className="checkout-form" onSubmit={submitCheckout}>
                    <span className="store-eyebrow">КУДА ОТПРАВИТЬ ЗАКАЗ?</span>
                    <div className="checkout-fields">
                      <input
                        required
                        placeholder="Имя"
                        value={recipient.firstName}
                        onChange={(event) =>
                          setRecipient({ ...recipient, firstName: event.target.value })
                        }
                      />
                      <input
                        required
                        placeholder="Фамилия"
                        value={recipient.lastName}
                        onChange={(event) =>
                          setRecipient({ ...recipient, lastName: event.target.value })
                        }
                      />
                      <input
                        required
                        className="checkout-wide"
                        placeholder="Адрес"
                        value={recipient.address}
                        onChange={(event) =>
                          setRecipient({ ...recipient, address: event.target.value })
                        }
                      />
                      <input
                        required
                        placeholder="Индекс"
                        value={recipient.zipCode}
                        onChange={(event) =>
                          setRecipient({ ...recipient, zipCode: event.target.value })
                        }
                      />
                      <input
                        required
                        placeholder="Телефон"
                        value={recipient.phone}
                        onChange={(event) =>
                          setRecipient({ ...recipient, phone: event.target.value })
                        }
                      />
                    </div>
                    <label className="checkout-select">
                      Оплата
                      <select
                        required
                        value={paymentId}
                        onChange={(event) => setPaymentId(event.target.value)}
                      >
                        <option value="">Выберите способ оплаты</option>
                        {shop.paymentMethods.map((method) => (
                          <option key={method.id} value={method.id}>
                            {method.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="checkout-select">
                      Доставка
                      <select
                        required
                        value={deliveryId}
                        onChange={(event) => setDeliveryId(event.target.value)}
                      >
                        <option value="">Выберите способ доставки</option>
                        {shop.deliveryMethods.map((method) => (
                          <option key={method.id} value={method.id}>
                            {method.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    {(!shop.paymentMethods.length || !shop.deliveryMethods.length) && (
                      <small className="checkout-hint">
                        Владелец магазина ещё не добавил доступные способы оплаты и доставки.
                      </small>
                    )}
                    <button
                      className="storefront-cta checkout-submit"
                      disabled={
                        loading || !shop.paymentMethods.length || !shop.deliveryMethods.length
                      }
                    >
                      {loading ? 'Оформляем…' : 'Подтвердить заказ'} <span>→</span>
                    </button>
                    <button
                      type="button"
                      className="checkout-back"
                      onClick={() => setCheckoutOpen(false)}
                    >
                      Вернуться к корзине
                    </button>
                  </form>
                ) : (
                  <button
                    className="storefront-cta cart-checkout"
                    onClick={() => {
                      if (!sessionStorage.getItem('accessToken')) {
                        setPendingGood(null);
                        setCartOpen(false);
                        setAuthMode('email');
                      } else setCheckoutOpen(true);
                    }}
                  >
                    Перейти к оформлению <span>→</span>
                  </button>
                )}
              </>
            ) : (
              <div className="cart-empty">
                <span>◇</span>
                <strong>Корзина пока пуста</strong>
                <small>Добавьте товары из каталога, чтобы продолжить.</small>
                <button onClick={() => setCartOpen(false)}>Вернуться к каталогу</button>
              </div>
            )}
          </aside>
        </div>
      )}

      {authMode !== 'closed' && (
        <div className="auth-overlay" role="presentation" onClick={() => setAuthMode('closed')}>
          <section
            className="customer-auth"
            role="dialog"
            aria-modal="true"
            aria-label="Вход в магазин"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="drawer-close auth-close"
              onClick={() => setAuthMode('closed')}
              aria-label="Закрыть"
            >
              ×
            </button>
            <span className="customer-mark">М</span>
            <span className="store-eyebrow">ПОКУПАТЕЛЬСКИЙ АККАУНТ</span>
            <h2>
              {authMode === 'email'
                ? signup
                  ? 'Создать аккаунт'
                  : 'Войти по почте'
                : 'Введите код'}
            </h2>
            <p>
              {authMode === 'email'
                ? 'Чтобы сохранить корзину и оформить заказ, подтвердите свою почту.'
                : `Одноразовый код отправлен на ${email}.`}
            </p>
            {authMode === 'email' ? (
              <form className="customer-form" onSubmit={requestCode}>
                {signup && (
                  <div className="checkout-fields">
                    <input
                      required
                      placeholder="Имя"
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                    />
                    <input
                      required
                      placeholder="Фамилия"
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                    />
                  </div>
                )}
                <input
                  type="email"
                  required
                  placeholder="Электронная почта"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                {error && <div className="cart-error">{error}</div>}
                <button className="storefront-cta" disabled={loading}>
                  {loading ? 'Отправляем…' : 'Получить код'} <span>→</span>
                </button>
                <button
                  type="button"
                  className="checkout-back"
                  onClick={() => {
                    setSignup(!signup);
                    setError('');
                  }}
                >
                  {signup ? 'Уже есть аккаунт? Войти' : 'Впервые здесь? Создать аккаунт'}
                </button>
              </form>
            ) : (
              <form className="customer-form" onSubmit={confirmCode}>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  pattern="[0-9]{6}"
                  maxLength={6}
                  placeholder="Шестизначный код"
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                />
                {debugCode && (
                  <div className="cart-debug">
                    Код локального запуска: <strong>{debugCode}</strong>
                  </div>
                )}
                {error && <div className="cart-error">{error}</div>}
                <button className="storefront-cta" disabled={loading}>
                  {loading ? 'Проверяем…' : 'Подтвердить почту'} <span>→</span>
                </button>
                <button
                  type="button"
                  className="checkout-back"
                  onClick={() => setAuthMode('email')}
                >
                  Изменить адрес
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </main>
  );
}
