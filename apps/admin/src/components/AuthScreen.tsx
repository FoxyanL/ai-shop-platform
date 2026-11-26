import { useState, type FormEvent } from 'react';
import { api } from '../services/api';
import type { User } from '../store/authSlice';

type Stage = 'email' | 'code';

export function AuthScreen({
  onSignedIn,
}: {
  onSignedIn: (data: { accessToken: string; user: User }) => void;
}) {
  const [stage, setStage] = useState<Stage>('email');
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [otp, setOtp] = useState('');
  const [debugCode, setDebugCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = isRegistering
        ? await api.post<{ debugCode?: string }>('/auth/register', { email, firstName, lastName })
        : await api.post<{ debugCode?: string }>('/auth/login', { email });
      setDebugCode(result.debugCode ?? '');
      setStage('code');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось отправить код');
    } finally {
      setLoading(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await api.post<{ accessToken: string; user: User }>('/auth/confirm', {
        email,
        otp,
      });
      onSignedIn(result);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Не удалось подтвердить код');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-story">
        <a className="brand brand-light" href="#overview">
          <span className="brand-mark">М</span>
          <span>
            мастерская<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="story-copy">
          <span className="eyebrow eyebrow-light">ВАШЕ РАБОЧЕЕ ПРОСТРАНСТВО</span>
          <h1>
            Магазин начинается
            <br />с вашей идеи.
          </h1>
          <p>
            Соберите витрину, добавьте товары и подготовьте магазин к публикации — всё в одном
            месте.
          </p>
        </div>
        <div className="story-footer">
          <span>Конструктор интернет-магазинов</span>
          <span>01 / 03</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-card-mark">М</div>
          <span className="eyebrow">
            {stage === 'email' ? 'РАБОЧЕЕ ПРОСТРАНСТВО' : 'ПРОВЕРКА ПОЧТЫ'}
          </span>
          <h2>
            {stage === 'email'
              ? isRegistering
                ? 'Создать аккаунт'
                : 'С возвращением'
              : 'Введите код'}
          </h2>
          <p className="muted">
            {stage === 'email'
              ? 'Войдите или начните создавать свой магазин.'
              : `Мы отправили одноразовый код на ${email}.`}
          </p>

          {stage === 'email' ? (
            <form className="form-stack" onSubmit={submitEmail}>
              {isRegistering && (
                <div className="field-row">
                  <label className="field">
                    Имя
                    <input
                      autoComplete="given-name"
                      required
                      value={firstName}
                      onChange={(event) => setFirstName(event.target.value)}
                      placeholder="Александр"
                    />
                  </label>
                  <label className="field">
                    Фамилия
                    <input
                      autoComplete="family-name"
                      required
                      value={lastName}
                      onChange={(event) => setLastName(event.target.value)}
                      placeholder="Алфеев"
                    />
                  </label>
                </div>
              )}
              <label className="field">
                Электронная почта
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="name@example.ru"
                />
              </label>
              {error && <div className="alert alert-error">{error}</div>}
              <button className="button button-primary button-wide" disabled={loading}>
                {loading
                  ? 'Отправляем…'
                  : isRegistering
                    ? 'Создать аккаунт'
                    : 'Получить код для входа'}
                <span>→</span>
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setIsRegistering(!isRegistering);
                  setError('');
                }}
              >
                {isRegistering ? 'Уже есть аккаунт? Войти' : 'Впервые здесь? Создать аккаунт'}
              </button>
            </form>
          ) : (
            <form className="form-stack" onSubmit={submitCode}>
              <label className="field">
                Одноразовый код
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  className="otp-input"
                />
              </label>
              {debugCode && (
                <div className="alert alert-info">
                  Код для локального запуска: <strong>{debugCode}</strong>
                </div>
              )}
              {error && <div className="alert alert-error">{error}</div>}
              <button className="button button-primary button-wide" disabled={loading}>
                {loading ? 'Проверяем…' : 'Войти в мастерскую'}
                <span>→</span>
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setStage('email');
                  setOtp('');
                  setError('');
                }}
              >
                Изменить адрес почты
              </button>
            </form>
          )}
          <div className="auth-note">
            <span className="note-lock">◈</span> Вход по одноразовому коду. Пароль создавать не
            нужно.
          </div>
        </div>
        <div className="auth-bottom">
          Создавайте магазины в своём темпе <span>© 2026 Мастерская</span>
        </div>
      </section>
    </main>
  );
}
