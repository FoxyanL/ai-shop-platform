import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AuthScreen } from './components/AuthScreen';
import { api } from './services/api';
import { signedIn, signedOut, type User } from './store/authSlice';
import type { RootState } from './store';

const storefrontUrl = import.meta.env.VITE_STOREFRONT_URL ?? 'http://localhost:3000';

type Shop = {
  id: string;
  title: string;
  slug: string;
  category: string;
  template: string;
  status: 'draft' | 'published';
  settings: Record<string, unknown>;
};

type Page<T> = { totalCount: number; items: T[]; nextPage: string | null; prevPage: string | null };
type SectionKey =
  | 'overview'
  | 'store'
  | 'products'
  | 'categories'
  | 'orders'
  | 'news'
  | 'users'
  | 'brands'
  | 'sizes'
  | 'payments'
  | 'delivery';
type FieldKind = 'text' | 'textarea' | 'number' | 'email' | 'url' | 'checkbox' | 'select';
type FieldSpec = {
  key: string;
  label: string;
  kind?: FieldKind;
  required?: boolean;
  options?: { label: string; value: string }[];
  nullable?: boolean;
  placeholder?: string;
};
type ResourceSpec = {
  key: string;
  title: string;
  description: string;
  fields: FieldSpec[];
  shopScoped?: boolean;
  readOnly?: boolean;
};

const resources: Partial<Record<SectionKey, ResourceSpec>> = {
  products: {
    key: 'goods',
    title: 'Товары',
    description: 'Добавляйте позиции в каталог и готовьте их к публикации.',
    shopScoped: true,
    fields: [
      { key: 'name', label: 'Название', required: true, placeholder: 'Керамическая чашка' },
      {
        key: 'description',
        label: 'Описание',
        kind: 'textarea',
        placeholder: 'Материал, детали и особенности товара',
      },
      { key: 'price', label: 'Цена, ₽', kind: 'number', required: true },
      { key: 'categoryId', label: 'Категория', kind: 'select', nullable: true },
      { key: 'stockCount', label: 'Остаток', kind: 'number' },
      { key: 'published', label: 'Показывать в магазине', kind: 'checkbox' },
    ],
  },
  categories: {
    key: 'good-categories',
    title: 'Категории',
    description: 'Создайте дерево каталога, чтобы покупателям было проще находить товары.',
    shopScoped: true,
    fields: [
      { key: 'title', label: 'Название категории', required: true },
      { key: 'description', label: 'Описание', kind: 'textarea' },
      { key: 'parentId', label: 'Родительская категория', kind: 'select', nullable: true },
    ],
  },
  news: {
    key: 'news',
    title: 'Новости',
    description: 'Публикуйте обновления платформы и полезные материалы.',
    fields: [
      { key: 'title', label: 'Заголовок', required: true },
      { key: 'slug', label: 'Адрес' },
      { key: 'summary', label: 'Краткий текст', kind: 'textarea' },
      { key: 'body', label: 'Содержание', kind: 'textarea' },
      { key: 'published', label: 'Опубликовать', kind: 'checkbox' },
    ],
  },
  users: {
    key: 'users',
    title: 'Пользователи',
    description: 'Управляйте учётными записями и доступом к платформе.',
    fields: [
      { key: 'email', label: 'Электронная почта', kind: 'email', required: true },
      { key: 'firstName', label: 'Имя' },
      { key: 'lastName', label: 'Фамилия' },
      {
        key: 'role',
        label: 'Роль',
        kind: 'select',
        options: [
          { label: 'Владелец магазина', value: 'shop_owner' },
          { label: 'Менеджер магазина', value: 'shop_manager' },
          { label: 'Покупатель', value: 'customer' },
          { label: 'Администратор платформы', value: 'platform_admin' },
        ],
      },
      { key: 'isActive', label: 'Доступ разрешён', kind: 'checkbox' },
    ],
  },
  brands: {
    key: 'brands',
    title: 'Бренды',
    description: 'Справочник брендов и производителей.',
    fields: [
      { key: 'title', label: 'Название', required: true },
      { key: 'description', label: 'Описание', kind: 'textarea' },
      { key: 'logoUrl', label: 'Ссылка на логотип', kind: 'url' },
    ],
  },
  sizes: {
    key: 'sizes',
    title: 'Размеры',
    description: 'Варианты размеров для каталога товаров.',
    fields: [
      { key: 'title', label: 'Название', required: true },
      { key: 'code', label: 'Код размера' },
    ],
  },
  payments: {
    key: 'payment-methods',
    title: 'Способы оплаты',
    description: 'Настройки способов оплаты для оформления заказа.',
    fields: [
      { key: 'title', label: 'Название', required: true },
      { key: 'description', label: 'Описание', kind: 'textarea' },
      { key: 'logoUrl', label: 'Ссылка на логотип', kind: 'url' },
      { key: 'isActive', label: 'Доступен', kind: 'checkbox' },
    ],
  },
  delivery: {
    key: 'delivery-methods',
    title: 'Доставка',
    description: 'Варианты доставки для покупателей.',
    fields: [
      { key: 'title', label: 'Название', required: true },
      { key: 'description', label: 'Описание', kind: 'textarea' },
      { key: 'logoUrl', label: 'Ссылка на логотип', kind: 'url' },
      { key: 'isActive', label: 'Доступна', kind: 'checkbox' },
    ],
  },
};

const ownerNavigation: { key: SectionKey; label: string; mark: string }[] = [
  { key: 'overview', label: 'Обзор', mark: '⌂' },
  { key: 'store', label: 'Мой магазин', mark: '▧' },
  { key: 'products', label: 'Товары', mark: '◇' },
  { key: 'categories', label: 'Категории', mark: '≡' },
  { key: 'orders', label: 'Заказы', mark: '▤' },
];
const adminNavigation: { key: SectionKey; label: string; mark: string }[] = [
  { key: 'news', label: 'Новости платформы', mark: '▣' },
  { key: 'users', label: 'Пользователи', mark: '♙' },
  { key: 'brands', label: 'Бренды', mark: '◇' },
  { key: 'sizes', label: 'Размеры', mark: '↔' },
  { key: 'payments', label: 'Оплата', mark: '₽' },
  { key: 'delivery', label: 'Доставка', mark: '⌁' },
];

function App() {
  const dispatch = useDispatch();
  const { accessToken, user } = useSelector((state: RootState) => state.auth);
  const [checkingSession, setCheckingSession] = useState(true);
  const [shops, setShops] = useState<Shop[]>([]);
  const [activeShopId, setActiveShopId] = useState('');
  const [section, setSection] = useState<SectionKey>('overview');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeShop = shops.find((shop) => shop.id === activeShopId) ?? shops[0];
  const isAdmin = user?.role === 'platform_admin';

  useEffect(() => {
    let alive = true;
    api
      .post<{ accessToken: string; user: User }>('/auth/refresh')
      .then((session) => {
        if (alive) dispatch(signedIn(session));
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setCheckingSession(false);
      });
    return () => {
      alive = false;
    };
  }, [dispatch]);

  useEffect(() => {
    if (!accessToken) return;
    setError('');
    api
      .get<{ items: Shop[] }>('/shops')
      .then((result) => {
        setShops(result.items);
        setActiveShopId((current) =>
          result.items.some((shop) => shop.id === current) ? current : (result.items[0]?.id ?? ''),
        );
      })
      .catch((requestError) =>
        setError(
          requestError instanceof Error ? requestError.message : 'Не удалось загрузить магазины',
        ),
      );
  }, [accessToken]);

  async function handleLogout() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* Сессия будет очищена на устройстве даже при сетевой ошибке. */
    }
    api.clearToken();
    dispatch(signedOut());
    setShops([]);
  }

  async function createShop(values: { title: string; category: string; template: string }) {
    setBusy(true);
    setError('');
    try {
      const shop = await api.post<Shop>('/shops', values);
      setShops((current) => [shop, ...current]);
      setActiveShopId(shop.id);
      setSection('store');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось создать магазин');
    } finally {
      setBusy(false);
    }
  }

  if (checkingSession)
    return (
      <div className="session-loader">
        <span className="loader-mark">М</span>
        <span>Открываем мастерскую…</span>
      </div>
    );
  if (!user || !accessToken)
    return <AuthScreen onSignedIn={(session) => dispatch(signedIn(session))} />;

  const navigation = isAdmin ? [...ownerNavigation, ...adminNavigation] : ownerNavigation;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#overview"
          onClick={(event) => {
            event.preventDefault();
            setSection('overview');
          }}
        >
          <span className="brand-mark">М</span>
          <span>
            мастерская<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace-switcher">
          <span className="workspace-icon">
            {activeShop?.title?.slice(0, 1) ?? user.email.slice(0, 1).toUpperCase()}
          </span>
          <span className="workspace-meta">
            <small>ВАШ МАГАЗИН</small>
            <strong>{activeShop?.title ?? 'Нет магазина'}</strong>
          </span>
          {shops.length > 1 && (
            <select
              aria-label="Выбрать магазин"
              value={activeShopId}
              onChange={(event) => setActiveShopId(event.target.value)}
            >
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.title}
                </option>
              ))}
            </select>
          )}
        </div>
        <nav className="side-nav" aria-label="Основная навигация">
          <span className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</span>
          {navigation.slice(0, 5).map((item) => (
            <button
              key={item.key}
              className={`nav-item ${section === item.key ? 'active' : ''}`}
              onClick={() => setSection(item.key)}
            >
              <span className="nav-mark">{item.mark}</span>
              {item.label}
              {item.key === 'orders' && (
                <span className="nav-count">{section === 'orders' ? '•••' : ''}</span>
              )}
            </button>
          ))}
          {isAdmin && (
            <>
              <span className="nav-caption nav-caption-gap">АДМИНИСТРИРОВАНИЕ</span>
              {navigation.slice(5).map((item) => (
                <button
                  key={item.key}
                  className={`nav-item ${section === item.key ? 'active' : ''}`}
                  onClick={() => setSection(item.key)}
                >
                  <span className="nav-mark">{item.mark}</span>
                  {item.label}
                </button>
              ))}
            </>
          )}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <span className="help-spark">✳</span>
            <div>
              <strong>Нужна помощь?</strong>
              <span>Задайте вопрос команде</span>
            </div>
            <button aria-label="Открыть помощь" onClick={() => setSection('overview')}>
              ↗
            </button>
          </div>
          <div className="account-row">
            <span className="avatar">
              {user.firstName?.slice(0, 1) ?? user.email.slice(0, 1).toUpperCase()}
            </span>
            <div className="account-meta">
              <strong>
                {user.firstName ? `${user.firstName} ${user.lastName ?? ''}` : user.email}
              </strong>
              <span>
                {user.role === 'platform_admin'
                  ? 'Администратор'
                  : user.role === 'shop_manager'
                    ? 'Менеджер магазина'
                    : user.role === 'customer'
                      ? 'Покупатель'
                      : 'Владелец магазина'}
              </span>
            </div>
            <button
              className="icon-button logout-button"
              onClick={handleLogout}
              aria-label="Выйти из аккаунта"
              title="Выйти"
            >
              ↗
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Мастерская</span>
            <span className="crumb-separator">/</span>
            <strong>{navigation.find((item) => item.key === section)?.label ?? 'Обзор'}</strong>
          </div>
          <div className="top-actions">
            <span className="status-pill">
              <i /> Рабочее пространство активно
            </span>
            <button className="button button-quiet top-help" onClick={() => setSection('overview')}>
              Справка <span>↗</span>
            </button>
          </div>
        </header>
        <div className="content-area">
          {error && (
            <div className="alert alert-error global-alert">
              {error}
              <button onClick={() => setError('')} aria-label="Скрыть сообщение">
                ×
              </button>
            </div>
          )}
          {shops.length === 0 && !isAdmin ? (
            <CreateStore onCreate={createShop} busy={busy} />
          ) : (
            <>
              {section === 'overview' && (
                <Overview
                  user={user}
                  shop={activeShop}
                  shopsCount={shops.length}
                  onNavigate={setSection}
                  onCreate={() => setSection('store')}
                />
              )}
              {section === 'store' &&
                (activeShop ? (
                  <StoreEditor
                    shop={activeShop}
                    onUpdate={(shop) =>
                      setShops((all) =>
                        all.map((current) => (current.id === shop.id ? shop : current)),
                      )
                    }
                  />
                ) : (
                  <CreateStore onCreate={createShop} busy={busy} />
                ))}
              {(section === 'products' || section === 'categories') &&
                resources[section] &&
                activeShop && (
                  <ResourceManager
                    key={`${section}-${activeShop.id}`}
                    spec={resources[section]!}
                    shop={activeShop}
                  />
                )}
              {section === 'orders' && activeShop && <Orders shop={activeShop} />}
              {isAdmin && resources[section] && !resources[section]?.shopScoped && (
                <ResourceManager key={section} spec={resources[section]!} />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Overview({
  user,
  shop,
  shopsCount,
  onNavigate,
  onCreate,
}: {
  user: User;
  shop?: Shop;
  shopsCount: number;
  onNavigate: (section: SectionKey) => void;
  onCreate: () => void;
}) {
  const [summary, setSummary] = useState({ products: 0, categories: 0, orders: 0 });
  useEffect(() => {
    if (!shop) return;
    Promise.all([
      api.get<Page<{ id: string }>>(`/goods?shopId=${shop.id}&limit=1`),
      api.get<Page<{ id: string }>>(`/good-categories?shopId=${shop.id}&limit=1`),
      api.get<{ items: unknown[] }>(`/shops/${shop.id}/orders`),
    ])
      .then(([products, categories, orders]) =>
        setSummary({
          products: products.totalCount,
          categories: categories.totalCount,
          orders: orders.items.length,
        }),
      )
      .catch(() => undefined);
  }, [shop?.id]);

  const firstName = user.firstName || user.email.split('@')[0];
  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <span className="eyebrow">
            {new Intl.DateTimeFormat('ru-RU', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })
              .format(new Date())
              .toLocaleUpperCase('ru-RU')}
          </span>
          <h1>
            Добро пожаловать, {firstName}
            <span className="brand-dot">.</span>
          </h1>
          <p className="lead">Ваше место, где идея становится магазином.</p>
        </div>
        <button className="button button-secondary" onClick={onCreate}>
          ＋ Создать магазин
        </button>
      </section>
      {shop ? (
        <>
          <section className="hero-card">
            <div className="hero-copy">
              <span className="hero-overline">
                <i /> ВАШ МАГАЗИН {shop.status === 'published' ? 'ОПУБЛИКОВАН' : 'В РАЗРАБОТКЕ'}
              </span>
              <h2>{shop.title}</h2>
              <p>
                {shop.category || 'Добавьте категорию и расскажите о своей идее'} — начните с
                каталога или настройте витрину.
              </p>
              <div className="hero-actions">
                <button className="button button-light" onClick={() => onNavigate('store')}>
                  Настроить витрину <span>→</span>
                </button>
                {shop.status === 'published' && (
                  <a
                    className="hero-link"
                    href={`${storefrontUrl}/${shop.slug}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Открыть магазин ↗
                  </a>
                )}
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="art-window">
                <div className="art-window-top">
                  <span />
                  <span />
                  <span />
                </div>
                <div className="art-window-content">
                  <div className="art-line art-line-short" />
                  <div className="art-line art-line-long" />
                  <div className="art-grid">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
              <span className="art-ring" />
              <span className="art-star">✳</span>
              <span className="art-leaf">⌁</span>
            </div>
          </section>
          <section className="stat-grid">
            <StatCard
              label="Товаров в каталоге"
              value={summary.products}
              note="в вашем магазине"
              mark="◇"
              onClick={() => onNavigate('products')}
            />
            <StatCard
              label="Категории"
              value={summary.categories}
              note="структура каталога"
              mark="≡"
              onClick={() => onNavigate('categories')}
            />
            <StatCard
              label="Заказы"
              value={summary.orders}
              note="за всё время"
              mark="▤"
              onClick={() => onNavigate('orders')}
            />
            <div className="stat-card stat-tip">
              <div className="tip-top">
                <span>✳</span>
                <span>СЛЕДУЮЩИЙ ШАГ</span>
              </div>
              <strong>{summary.products ? 'Проверьте витрину' : 'Добавьте первый товар'}</strong>
              <button onClick={() => onNavigate(summary.products ? 'store' : 'products')}>
                {summary.products ? 'Перейти к оформлению' : 'Открыть каталог'} <span>→</span>
              </button>
            </div>
          </section>
          <section className="lower-grid">
            <div className="panel progress-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">ПУТЬ К ПУБЛИКАЦИИ</span>
                  <h3>Витрина готовится</h3>
                </div>
                <span className="progress-number">
                  {shop.status === 'published' ? '100%' : summary.products > 0 ? '60%' : '25%'}
                </span>
              </div>
              <div className="progress-track">
                <span
                  style={{
                    width:
                      shop.status === 'published' ? '100%' : summary.products > 0 ? '60%' : '25%',
                  }}
                />
              </div>
              <div className="checklist">
                <ChecklistItem done label="Магазин создан" />
                <ChecklistItem done={Boolean(shop.category)} label="Указана сфера бизнеса" />
                <ChecklistItem done={summary.products > 0} label="Добавлен первый товар" />
                <ChecklistItem done={shop.status === 'published'} label="Магазин опубликован" />
              </div>
            </div>
            <div className="panel quick-panel">
              <span className="eyebrow">БЫСТРЫЕ ДЕЙСТВИЯ</span>
              <h3>Что будем делать?</h3>
              <button className="quick-action" onClick={() => onNavigate('products')}>
                <span className="quick-icon quick-icon-sand">◇</span>
                <span>
                  <strong>Добавить товар</strong>
                  <small>Пополнить каталог магазина</small>
                </span>
                <i>→</i>
              </button>
              <button className="quick-action" onClick={() => onNavigate('categories')}>
                <span className="quick-icon quick-icon-sage">≡</span>
                <span>
                  <strong>Настроить категории</strong>
                  <small>Продумать навигацию каталога</small>
                </span>
                <i>→</i>
              </button>
            </div>
          </section>
        </>
      ) : (
        <section className="empty-state">
          <div className="empty-illustration">
            <span>М</span>
            <i>✳</i>
          </div>
          <span className="eyebrow">С ЧЕГО НАЧНЁМ?</span>
          <h2>Создайте своё первое пространство</h2>
          <p>
            Название, сфера и шаблон помогут настроить витрину под ваш магазин. Это займёт несколько
            минут.
          </p>
          <button className="button button-primary" onClick={onCreate}>
            Создать магазин <span>→</span>
          </button>
          <small>Магазинов в аккаунте: {shopsCount}</small>
        </section>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  mark,
  onClick,
}: {
  label: string;
  value: number;
  note: string;
  mark: string;
  onClick: () => void;
}) {
  return (
    <button className="stat-card" onClick={onClick}>
      <span className="stat-mark">{mark}</span>
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      <span className="stat-note">
        {note}
        <i>→</i>
      </span>
    </button>
  );
}

function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="checklist-item">
      <span className={done ? 'check-dot checked' : 'check-dot'}>{done ? '✓' : ''}</span>
      <span className={done ? 'check-label done' : 'check-label'}>{label}</span>
      {done && <small>ГОТОВО</small>}
    </div>
  );
}

function CreateStore({
  onCreate,
  busy,
}: {
  onCreate: (values: { title: string; category: string; template: string }) => void;
  busy: boolean;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [template, setTemplate] = useState('atelier');
  const options = [
    {
      id: 'atelier',
      label: 'Тёплая мастерская',
      category: 'Авторские товары',
      tone: 'template-art',
    },
    {
      id: 'market',
      label: 'Современный маркет',
      category: 'Универсальный магазин',
      tone: 'template-market',
    },
    { id: 'flora', label: 'Цветочная лавка', category: 'Цветы и растения', tone: 'template-flora' },
  ];
  function submit(event: FormEvent) {
    event.preventDefault();
    onCreate({ title, category, template });
  }
  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">ШАГ 01 · НОВОЕ ПРОСТРАНСТВО</span>
        <h1>Создадим ваш магазин</h1>
        <p className="lead">Укажите пару деталей — и мы подготовим основу для вашей витрины.</p>
      </div>
      <form className="create-layout" onSubmit={submit}>
        <div className="panel create-form">
          <span className="section-number">
            01 <i /> ОСНОВА
          </span>
          <label className="field">
            Как будет называться магазин?
            <input
              required
              minLength={2}
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Например, Лист и Лён"
            />
            <small>Название можно изменить в любой момент.</small>
          </label>
          <label className="field">
            Чем занимается ваш магазин?
            <select required value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">Выберите сферу</option>
              <option>Одежда и аксессуары</option>
              <option>Авторские товары</option>
              <option>Дом и интерьер</option>
              <option>Красота и уход</option>
              <option>Цветы и растения</option>
              <option>Электроника</option>
              <option>Другое</option>
            </select>
          </label>
          <span className="field-label">Выберите отправную точку</span>
          <div className="template-options">
            {options.map((option) => (
              <button
                type="button"
                key={option.id}
                className={`template-option ${template === option.id ? 'selected' : ''}`}
                onClick={() => setTemplate(option.id)}
              >
                <span className={`template-preview ${option.tone}`}>
                  <i />
                  <i />
                  <i />
                </span>
                <span className="template-info">
                  <strong>{option.label}</strong>
                  <small>{option.category}</small>
                </span>
                <span className="radio-mark">{template === option.id ? '✓' : ''}</span>
              </button>
            ))}
          </div>
          <button className="button button-primary button-wide create-submit" disabled={busy}>
            {busy ? 'Создаём магазин…' : 'Создать магазин'}
            <span>→</span>
          </button>
        </div>
        <aside className="create-aside">
          <div className="aside-stamp">✳</div>
          <span className="eyebrow">ПРОСТОЙ СТАРТ</span>
          <h3>
            Сначала основа,
            <br />
            остальное — по пути.
          </h3>
          <p>
            После создания вы сможете добавить товары, поменять оформление и подготовить магазин к
            публикации.
          </p>
          <div className="aside-step">
            <span>1</span>
            <div>
              <strong>Вы задаёте направление</strong>
              <small>Название, сфера, шаблон</small>
            </div>
          </div>
          <div className="aside-step">
            <span>2</span>
            <div>
              <strong>Наполняете каталог</strong>
              <small>Товары и категории</small>
            </div>
          </div>
          <div className="aside-step">
            <span>3</span>
            <div>
              <strong>Открываете витрину</strong>
              <small>Настройка и публикация</small>
            </div>
          </div>
        </aside>
      </form>
    </div>
  );
}

function StoreEditor({ shop, onUpdate }: { shop: Shop; onUpdate: (shop: Shop) => void }) {
  const settings = (shop.settings ?? {}) as Record<string, string>;
  const [heroTitle, setHeroTitle] = useState(settings.heroTitle ?? shop.title);
  const [heroText, setHeroText] = useState(
    settings.heroText ?? 'Вещи, созданные с заботой и вниманием к деталям.',
  );
  const [accent, setAccent] = useState(settings.accent ?? '#1f493d');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setHeroTitle(settings.heroTitle ?? shop.title);
    setHeroText(settings.heroText ?? 'Вещи, созданные с заботой и вниманием к деталям.');
    setAccent(settings.accent ?? '#1f493d');
  }, [shop.id]);

  async function save() {
    setLoading(true);
    setMessage('');
    try {
      const updated = await api.patch<Shop>(`/shops/${shop.id}`, {
        settings: { ...settings, heroTitle, heroText, accent },
      });
      onUpdate(updated);
      setMessage('Изменения сохранены.');
    } catch (requestError) {
      setMessage(
        requestError instanceof Error ? requestError.message : 'Не удалось сохранить настройки',
      );
    } finally {
      setLoading(false);
    }
  }
  async function publish() {
    setLoading(true);
    setMessage('');
    try {
      const published = await api.post<Shop>(`/shops/${shop.id}/publish`);
      onUpdate({ ...shop, ...published });
      setMessage('Магазин опубликован. Теперь он доступен по своей ссылке.');
    } catch (requestError) {
      setMessage(
        requestError instanceof Error ? requestError.message : 'Не удалось опубликовать магазин',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading heading-with-actions">
        <div>
          <span className="eyebrow">КОНСТРУКТОР ВИТРИНЫ</span>
          <h1>Настроить магазин</h1>
          <p className="lead">
            Соберите первое впечатление о магазине и сразу посмотрите, как оно выглядит.
          </p>
        </div>
        <div className="heading-actions">
          <span className={`draft-label ${shop.status === 'published' ? 'published' : ''}`}>
            <i />
            {shop.status === 'published' ? 'Опубликован' : 'Черновик'}
          </span>
          <button
            className="button button-primary"
            onClick={publish}
            disabled={loading || shop.status === 'published'}
          >
            {shop.status === 'published' ? 'Магазин опубликован' : 'Опубликовать'}
            <span>↗</span>
          </button>
        </div>
      </div>
      <div className="builder-layout">
        <section className="panel builder-controls">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">ГЛАВНЫЙ ЭКРАН</span>
              <h3>Первый экран витрины</h3>
            </div>
            <span className="builder-step">01 / 04</span>
          </div>
          <label className="field">
            Заголовок
            <textarea
              rows={2}
              maxLength={120}
              value={heroTitle}
              onChange={(event) => setHeroTitle(event.target.value)}
            />
          </label>
          <label className="field">
            Короткое описание
            <textarea
              rows={3}
              maxLength={300}
              value={heroText}
              onChange={(event) => setHeroText(event.target.value)}
            />
          </label>
          <label className="field color-field">
            Основной цвет{' '}
            <span className="color-control">
              <input
                type="color"
                value={accent}
                onChange={(event) => setAccent(event.target.value)}
              />
              <code>{accent.toUpperCase()}</code>
            </span>
          </label>
          <button className="button button-secondary button-wide" onClick={save} disabled={loading}>
            {loading ? 'Сохраняем…' : 'Сохранить изменения'} <span>↓</span>
          </button>
          {message && (
            <div className={message.startsWith('Не') ? 'alert alert-error' : 'alert alert-success'}>
              {message}
            </div>
          )}
          <div className="editor-note">
            <span>✳</span>
            <p>
              Пока можно настроить главный экран. Редактор блоков и дополнительные шаблоны добавим
              следующими итерациями.
            </p>
          </div>
        </section>
        <section className="preview-panel">
          <div className="preview-toolbar">
            <span className="preview-title">
              <i /> ПРЕДПРОСМОТР
            </span>
            <div className="preview-modes">
              <button className="selected" aria-label="Компьютерная версия">
                ▱
              </button>
              <button aria-label="Мобильная версия">▯</button>
            </div>
            <a
              href={`${storefrontUrl}/${shop.slug}`}
              target="_blank"
              rel="noreferrer"
              title="Открыть публичную витрину"
            >
              ↗
            </a>
          </div>
          <div className="store-preview">
            <div className="store-preview-nav">
              <strong>
                {shop.title}
                <i>.</i>
              </strong>
              <span>Каталог О магазине Доставка</span>
              <span className="preview-bag">Сумка (0)</span>
            </div>
            <div className="store-preview-hero" style={{ backgroundColor: `${accent}12` }}>
              <span className="preview-kicker">{shop.category || 'МАГАЗИН ДЛЯ ВАС'}</span>
              <h2>{heroTitle}</h2>
              <p>{heroText}</p>
              <button style={{ background: accent }}>
                Смотреть коллекцию <i>→</i>
              </button>
              <div className="preview-object">
                <span />
                <i>✳</i>
              </div>
            </div>
            <div className="preview-products">
              <div>
                <span>НАЙДИТЕ СВОЁ</span>
                <strong>Популярное в магазине</strong>
              </div>
              <i>Скоро здесь появятся ваши товары</i>
            </div>
          </div>
          <div className="preview-foot">
            <span>Витрина обновляется вместе с вашими настройками</span>
            <span>
              {storefrontUrl}/{shop.slug}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

function ResourceManager({ spec, shop }: { spec: ResourceSpec; shop?: Shop }) {
  const [items, setItems] = useState<Record<string, unknown>[]>([]);
  const [categories, setCategories] = useState<
    { id: string | number; title: string; parentId: string | number | null }[]
  >([]);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const endpoint = useMemo(
    () => `/${spec.key}${spec.shopScoped && shop ? `?shopId=${shop.id}` : ''}`,
    [spec.key, spec.shopScoped, shop?.id],
  );
  async function load() {
    setLoading(true);
    try {
      const result = await api.get<Page<Record<string, unknown>>>(endpoint);
      setItems(result.items);
    } catch (requestError) {
      setMessage(
        requestError instanceof Error ? requestError.message : 'Не удалось загрузить данные',
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [endpoint]);
  useEffect(() => {
    if (!shop || !['goods', 'good-categories'].includes(spec.key)) return;
    api
      .get<Page<{ id: string | number; title: string; parentId: string | number | null }>>(
        `/good-categories?shopId=${shop.id}&limit=100`,
      )
      .then((result) => setCategories(result.items))
      .catch(() => setCategories([]));
  }, [shop?.id, spec.key]);

  function resetForm() {
    setEditingId(null);
    setValues(
      Object.fromEntries(
        spec.fields.map((field) => [field.key, field.kind === 'checkbox' ? false : '']),
      ),
    );
  }
  function editItem(item: Record<string, unknown>) {
    setEditingId(item.id as string | number);
    setValues(
      Object.fromEntries(
        spec.fields.map((field) => [
          field.key,
          item[field.key] === null || item[field.key] === undefined
            ? ''
            : (item[field.key] as string | boolean),
        ]),
      ),
    );
  }
  function formValue(field: FieldSpec) {
    const value = values[field.key];
    if (field.kind === 'checkbox') return Boolean(value);
    if (field.kind === 'number')
      return value === '' || value === undefined ? (field.nullable ? null : 0) : Number(value);
    if (field.kind === 'select' && field.nullable && (value === '' || value === undefined))
      return null;
    if (typeof value === 'string' && value === '') return undefined;
    return value;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    const body: Record<string, unknown> = {};
    for (const field of spec.fields) {
      const value = formValue(field);
      if (value !== undefined) body[field.key] = value;
    }
    if (spec.shopScoped && shop) body.shopId = shop.id;
    try {
      if (editingId === null) await api.post(`/${spec.key}`, body);
      else await api.patch(`/${spec.key}/${editingId}`, body);
      setMessage(editingId === null ? 'Запись добавлена.' : 'Изменения сохранены.');
      resetForm();
      await load();
    } catch (requestError) {
      setMessage(
        requestError instanceof Error ? requestError.message : 'Не удалось сохранить запись',
      );
    } finally {
      setSaving(false);
    }
  }
  async function removeItem(id: string | number) {
    if (!window.confirm('Удалить эту запись?')) return;
    try {
      await api.delete(`/${spec.key}/${id}`);
      setItems((current) => current.filter((item) => item.id !== id));
      setMessage('Запись удалена.');
    } catch (requestError) {
      setMessage(
        requestError instanceof Error ? requestError.message : 'Не удалось удалить запись',
      );
    }
  }

  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">
          {shop ? shop.title.toUpperCase() : 'АДМИНИСТРИРОВАНИЕ ПЛАТФОРМЫ'}
        </span>
        <h1>{spec.title}</h1>
        <p className="lead">{spec.description}</p>
      </div>
      <div className="resource-layout">
        <section className="panel resource-list">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">РАБОЧИЙ СПИСОК</span>
              <h3>
                {items.length} {plural(items.length)}
              </h3>
            </div>
            <button className="button button-quiet" onClick={() => void load()}>
              Обновить ↻
            </button>
          </div>
          {message && (
            <div className={message.startsWith('Не') ? 'alert alert-error' : 'alert alert-success'}>
              {message}
            </div>
          )}
          {loading ? (
            <div className="list-empty">Загружаем список…</div>
          ) : items.length === 0 ? (
            <div className="list-empty">
              <span>◇</span>
              <strong>Здесь пока пусто</strong>
              <small>Добавьте первую запись через форму справа.</small>
            </div>
          ) : (
            <div className="data-list">
              {items.map((item) => (
                <article className="data-row" key={String(item.id)}>
                  <span className="data-avatar">
                    {String(item.name ?? item.title ?? item.email ?? 'М')
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <div className="data-info">
                    <strong>
                      {String(item.name ?? item.title ?? item.email ?? `Запись ${item.id}`)}
                    </strong>
                    <span>
                      {spec.key === 'goods'
                        ? (categories.find(
                            (category) => String(category.id) === String(item.categoryId),
                          )?.title ?? 'Без категории')
                        : spec.key === 'good-categories' && item.parentId
                          ? `Вложена в: ${categories.find((category) => String(category.id) === String(item.parentId))?.title ?? `категорию ${item.parentId}`}`
                          : String(
                              item.description ?? item.summary ?? item.role ?? item.code ?? '',
                            )}
                    </span>
                  </div>
                  {spec.key === 'goods' && (
                    <strong className="data-price">{formatMoney(item.price)}</strong>
                  )}
                  {spec.key === 'goods' && (
                    <span className={item.published ? 'published-tag' : 'draft-tag'}>
                      {item.published ? 'На витрине' : 'Черновик'}
                    </span>
                  )}
                  <div className="data-actions">
                    <button
                      className="icon-button"
                      onClick={() => editItem(item)}
                      aria-label="Изменить"
                    >
                      ✎
                    </button>
                    <button
                      className="icon-button delete-action"
                      onClick={() => void removeItem(item.id as string | number)}
                      aria-label="Удалить"
                    >
                      ×
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <form className="panel resource-form" onSubmit={submit}>
          <span className="eyebrow">{editingId === null ? 'НОВАЯ ЗАПИСЬ' : 'РЕДАКТИРОВАНИЕ'}</span>
          <h3>{editingId === null ? `Добавить ${noun(spec.key)}` : 'Изменить запись'}</h3>
          {spec.fields.map((field) => (
            <label
              className={`field ${field.kind === 'checkbox' ? 'checkbox-field' : ''}`}
              key={field.key}
            >
              {field.kind === 'checkbox' ? (
                <>
                  <input
                    type="checkbox"
                    checked={Boolean(values[field.key])}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field.key]: event.target.checked }))
                    }
                  />
                  {field.label}
                </>
              ) : (
                <>
                  {field.label}
                  {field.kind === 'textarea' ? (
                    <textarea
                      required={field.required}
                      rows={3}
                      value={String(values[field.key] ?? '')}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                      placeholder={field.placeholder}
                    />
                  ) : field.kind === 'select' ? (
                    <select
                      value={String(values[field.key] ?? '')}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                    >
                      {field.options ? (
                        <>
                          {field.nullable && <option value="">Не выбрано</option>}
                          {field.options.map((option) => (
                            <option value={option.value} key={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </>
                      ) : (
                        <>
                          <option value="">Не выбрано</option>
                          {categories
                            .filter(
                              (category) =>
                                spec.key !== 'good-categories' ||
                                String(category.id) !== String(editingId),
                            )
                            .map((category) => (
                              <option value={category.id} key={category.id}>
                                {category.title}
                              </option>
                            ))}
                        </>
                      )}
                    </select>
                  ) : (
                    <input
                      type={field.kind ?? 'text'}
                      required={field.required}
                      min={field.kind === 'number' ? 0 : undefined}
                      value={String(values[field.key] ?? '')}
                      onChange={(event) =>
                        setValues((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                      placeholder={field.placeholder}
                    />
                  )}
                </>
              )}
            </label>
          ))}
          <button className="button button-primary button-wide" disabled={saving}>
            {saving ? 'Сохраняем…' : editingId === null ? 'Добавить запись' : 'Сохранить'}
            <span>→</span>
          </button>
          {editingId !== null && (
            <button type="button" className="text-button" onClick={resetForm}>
              Отменить редактирование
            </button>
          )}
          <small className="form-footnote">Изменения сохраняются в базе данных проекта.</small>
        </form>
      </div>
    </div>
  );
}

function Orders({ shop }: { shop: Shop }) {
  const [orders, setOrders] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    api
      .get<{ items: Record<string, unknown>[] }>(`/shops/${shop.id}/orders`)
      .then((result) => setOrders(result.items))
      .catch((requestError) =>
        setError(
          requestError instanceof Error ? requestError.message : 'Не удалось загрузить заказы',
        ),
      )
      .finally(() => setLoading(false));
  }, [shop.id]);
  return (
    <div className="page-stack">
      <div className="page-heading">
        <span className="eyebrow">{shop.title.toUpperCase()}</span>
        <h1>Заказы</h1>
        <p className="lead">Просматривайте оформления из вашей витрины.</p>
      </div>
      <section className="panel resource-list orders-list">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">ИСТОРИЯ ПРОДАЖ</span>
            <h3>
              {orders.length} {plural(orders.length)}
            </h3>
          </div>
          <span className="status-pill">
            <i /> Обновлено сейчас
          </span>
        </div>
        {error && <div className="alert alert-error">{error}</div>}
        {loading ? (
          <div className="list-empty">Загружаем заказы…</div>
        ) : orders.length === 0 ? (
          <div className="list-empty">
            <span>▤</span>
            <strong>Пока нет заказов</strong>
            <small>Когда покупатель оформит заказ, он появится здесь.</small>
          </div>
        ) : (
          <div className="data-list">
            {orders.map((order) => (
              <article className="order-row" key={String(order.id)}>
                <span className="order-id">#{String(order.id).slice(0, 8)}</span>
                <div className="data-info">
                  <strong>
                    {String(
                      (order.recipient as Record<string, unknown>)?.firstName ?? 'Покупатель',
                    )}{' '}
                    {String((order.recipient as Record<string, unknown>)?.lastName ?? '')}
                  </strong>
                  <span>
                    {formatDate(order.createdAt)} ·{' '}
                    {(order.items as unknown[] | undefined)?.length ?? 0} товара
                  </span>
                </div>
                <span className="order-status">{String(order.status)}</span>
                <strong className="data-price">{formatMoney(order.amount)}</strong>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function plural(count: number) {
  return count === 1 ? 'запись' : count > 1 && count < 5 ? 'записи' : 'записей';
}
function noun(key: string) {
  return (
    (
      {
        goods: 'товар',
        'good-categories': 'категорию',
        news: 'новость',
        users: 'пользователя',
        brands: 'бренд',
        sizes: 'размер',
        'payment-methods': 'способ оплаты',
        'delivery-methods': 'способ доставки',
      } as Record<string, string>
    )[key] ?? 'запись'
  );
}
function formatMoney(value: unknown) {
  return `${Number(value ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
}
function formatDate(value: unknown) {
  return value ? new Date(String(value)).toLocaleDateString('ru-RU') : 'Дата не указана';
}

export default App;
