"""Локальный сервер прототипа конструктора интернет-магазинов."""

from __future__ import annotations

import hashlib
import hmac
import json
import mimetypes
import os
import re
import secrets
import sqlite3
import time
import uuid
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("SHOP_DB_PATH", ROOT / "data" / "shops.sqlite3"))
HOST = os.environ.get("SHOP_HOST", "127.0.0.1")
PORT = int(os.environ.get("SHOP_PORT", "8025"))
SESSION_COOKIE = "shop_session"
SESSION_DAYS = 7
PASSWORD_ROUNDS = 310_000
MAX_BODY_BYTES = 2 * 1024 * 1024
TEMPLATES = {"calm", "atelier", "fresh"}
SECTIONS = {"catalog", "story", "benefits"}
ALLOWED_STATUSES = {"Опубликован", "Черновик"}
ALLOWED_ORDER_STATUSES = {"Новый", "В обработке", "Отправлен", "Отменен"}
ALLOWED_ICONS = {"🏺", "☕", "🧺", "🕯️", "🍽️", "📦"}


def connect_db() -> sqlite3.Connection:
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_db() -> None:
    with connect_db() as db:
        db.execute("PRAGMA journal_mode = WAL")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL COLLATE NOCASE UNIQUE,
                display_name TEXT NOT NULL,
                password_salt TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS shops (
                id TEXT PRIMARY KEY,
                owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                source_id TEXT,
                data_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(owner_id, source_id)
            );
            CREATE INDEX IF NOT EXISTS shops_owner_idx ON shops(owner_id);
            """
        )


def hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ROUNDS)
    return salt.hex(), digest.hex()


def public_user(row: sqlite3.Row) -> dict[str, str]:
    return {"id": row["id"], "email": row["email"], "displayName": row["display_name"]}


def clean_text(value: object, limit: int, fallback: str = "") -> str:
    if not isinstance(value, str):
        return fallback
    return value.strip()[:limit]


def clean_products(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    products = []
    for item in value[:200]:
        if not isinstance(item, dict):
            continue
        try:
            price = max(0, min(int(item.get("price", 0)), 100_000_000))
            stock = max(0, min(int(item.get("stock", 0)), 1_000_000))
            tone = max(1, min(int(item.get("tone", 1)), 6))
        except (TypeError, ValueError):
            continue
        raw_status = item.get("status")
        status = raw_status if isinstance(raw_status, str) and raw_status in ALLOWED_STATUSES else "Черновик"
        raw_icon = item.get("icon")
        icon = raw_icon if isinstance(raw_icon, str) and raw_icon in ALLOWED_ICONS else "📦"
        products.append({
            "id": clean_text(item.get("id"), 80, str(uuid.uuid4())),
            "name": clean_text(item.get("name"), 160, "Товар"),
            "category": clean_text(item.get("category"), 100, "Без категории"),
            "price": price,
            "stock": stock,
            "status": status,
            "icon": icon,
            "tone": tone,
            "description": clean_text(item.get("description"), 2000),
        })
    return products


def clean_orders(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    orders = []
    for item in value[:2000]:
        if not isinstance(item, dict):
            continue
        try:
            total = max(0, min(int(item.get("total", 0)), 1_000_000_000))
        except (TypeError, ValueError):
            continue
        raw_status = item.get("status")
        status = raw_status if isinstance(raw_status, str) and raw_status in ALLOWED_ORDER_STATUSES else "Новый"
        orders.append({
            "id": clean_text(item.get("id"), 80, str(uuid.uuid4())),
            "customer": clean_text(item.get("customer"), 160, "Покупатель"),
            "initials": clean_text(item.get("initials"), 8),
            "items": clean_text(item.get("items"), 1000),
            "total": total,
            "date": clean_text(item.get("date"), 80),
            "status": status,
        })
    return orders


def clean_shop(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError("Проверьте данные магазина")
    name = clean_text(value.get("name"), 60)
    if not name:
        raise ValueError("Укажите название магазина")
    raw_template = value.get("template")
    template = raw_template if isinstance(raw_template, str) and raw_template in TEMPLATES else "calm"
    accent = value.get("accent")
    if not isinstance(accent, str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", accent):
        accent = {"calm": "#65806a", "atelier": "#333b42", "fresh": "#bd7048"}[template]
    raw_sections = value.get("sections") if isinstance(value.get("sections"), dict) else {}
    sections = {section: bool(raw_sections.get(section, True)) for section in SECTIONS}
    shop = {
        "name": name,
        "niche": clean_text(value.get("niche"), 80, "Другое"),
        "template": template,
        "accent": accent,
        "heroTitle": clean_text(value.get("heroTitle"), 160, name),
        "heroDescription": clean_text(value.get("heroDescription"), 500),
        "published": bool(value.get("published", False)),
        "sections": sections,
        "products": clean_products(value.get("products")),
        "orders": clean_orders(value.get("orders")),
    }
    published_at = clean_text(value.get("publishedAt"), 40)
    if published_at:
        shop["publishedAt"] = published_at
    return shop


class ShopHandler(BaseHTTPRequestHandler):
    server_version = "ShopBuilder/0.1"

    def log_message(self, format_string: str, *args: object) -> None:
        print(f"{self.log_date_time_string()} {self.address_string()} {format_string % args}")

    def send_json(self, status: int, data: object, cookie: str | None = None) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def read_json(self) -> dict[str, object]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Некорректный размер запроса") from error
        if length < 0 or length > MAX_BODY_BYTES:
            raise ValueError("Запрос слишком большой")
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Не удалось прочитать данные запроса") from error
        if not isinstance(value, dict):
            raise ValueError("Ожидался объект с данными")
        return value

    def check_same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        if not origin:
            return False
        parsed = urlsplit(origin)
        expected_scheme = "https" if self.headers.get("X-Forwarded-Proto", "http") == "https" else "http"
        return parsed.scheme == expected_scheme and parsed.netloc.lower() == self.headers.get("Host", "").lower()

    def get_user(self) -> sqlite3.Row | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        morsel = cookie.get(SESSION_COOKIE)
        if morsel is None:
            return None
        token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
        now = int(time.time())
        with connect_db() as db:
            row = db.execute(
                "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.token_hash = ? AND sessions.expires_at > ?",
                (token_hash, now),
            ).fetchone()
            if row is None:
                db.execute("DELETE FROM sessions WHERE token_hash = ? OR expires_at <= ?", (token_hash, now))
            return row

    def require_user(self) -> sqlite3.Row | None:
        user = self.get_user()
        if user is None:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Войдите в аккаунт, чтобы продолжить"})
        return user

    def user_shops(self, owner_id: str) -> list[dict[str, object]]:
        with connect_db() as db:
            rows = db.execute(
                "SELECT id, data_json FROM shops WHERE owner_id = ? ORDER BY created_at, id",
                (owner_id,),
            ).fetchall()
        return [{"id": row["id"], **json.loads(row["data_json"])} for row in rows]

    def session_cookie(self, token: str, max_age: int) -> str:
        secure = "; Secure" if os.environ.get("SHOP_COOKIE_SECURE") == "1" else ""
        return f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}"

    def create_session(self, db: sqlite3.Connection, user_id: str) -> tuple[str, int]:
        now = int(time.time())
        db.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
        token = secrets.token_urlsafe(32)
        expires_at = now + SESSION_DAYS * 24 * 60 * 60
        db.execute(
            "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
            (hashlib.sha256(token.encode("utf-8")).hexdigest(), user_id, expires_at),
        )
        return token, expires_at

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path == "/api/auth/me":
            user = self.require_user()
            if user is not None:
                self.send_json(HTTPStatus.OK, {"user": public_user(user), "shops": self.user_shops(user["id"])})
            return
        if path == "/api/shops":
            user = self.require_user()
            if user is not None:
                self.send_json(HTTPStatus.OK, {"shops": self.user_shops(user["id"])})
            return
        self.serve_static(path)

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if not self.check_same_origin():
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "Запрос должен прийти с этого сайта"})
            return
        try:
            data = self.read_json()
            if path == "/api/auth/register":
                self.register(data)
            elif path == "/api/auth/login":
                self.login(data)
            elif path == "/api/auth/logout":
                self.logout()
            elif path == "/api/shops":
                self.create_shop(data)
            elif path == "/api/shops/import":
                self.import_shops(data)
            else:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "Маршрут не найден"})
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    def do_PUT(self) -> None:
        path = urlsplit(self.path).path
        if not self.check_same_origin():
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "Запрос должен прийти с этого сайта"})
            return
        user = self.require_user()
        if user is None:
            return
        match = re.fullmatch(r"/api/shops/([A-Za-z0-9_-]+)", path)
        if not match:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Маршрут не найден"})
            return
        try:
            shop = clean_shop(self.read_json())
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        shop_id = match.group(1)
        with connect_db() as db:
            result = db.execute(
                "UPDATE shops SET data_json = ?, updated_at = ? WHERE id = ? AND owner_id = ?",
                (json.dumps(shop, ensure_ascii=False), int(time.time()), shop_id, user["id"]),
            )
        if result.rowcount == 0:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "Магазин не найден"})
            return
        self.send_json(HTTPStatus.OK, {"shop": {"id": shop_id, **shop}})

    def register(self, data: dict[str, object]) -> None:
        display_name = clean_text(data.get("displayName"), 80)
        email = clean_text(data.get("email"), 254).lower()
        password = data.get("password")
        if len(display_name) < 2:
            raise ValueError("Введите имя не короче двух символов")
        if not re.fullmatch(r"[^\s@]{1,64}@[^\s@.]+(?:\.[^\s@.]+)+", email):
            raise ValueError("Введите корректный адрес электронной почты")
        if not isinstance(password, str) or not 8 <= len(password) <= 128:
            raise ValueError("Пароль должен содержать от 8 до 128 символов")
        salt, password_hash = hash_password(password)
        user_id = str(uuid.uuid4())
        now = int(time.time())
        try:
            with connect_db() as db:
                db.execute(
                    "INSERT INTO users(id, email, display_name, password_salt, password_hash, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (user_id, email, display_name, salt, password_hash, now),
                )
                token, _ = self.create_session(db, user_id)
        except sqlite3.IntegrityError:
            self.send_json(HTTPStatus.CONFLICT, {"error": "Аккаунт с такой почтой уже зарегистрирован"})
            return
        with connect_db() as db:
            user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        self.send_json(
            HTTPStatus.CREATED,
            {"user": public_user(user), "shops": []},
            self.session_cookie(token, SESSION_DAYS * 24 * 60 * 60),
        )

    def login(self, data: dict[str, object]) -> None:
        email = clean_text(data.get("email"), 254).lower()
        password = data.get("password")
        if not isinstance(password, str) or not email:
            self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Неверная почта или пароль"})
            return
        with connect_db() as db:
            user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if user is None:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Неверная почта или пароль"})
                return
            _, candidate = hash_password(password, bytes.fromhex(user["password_salt"]))
            if not hmac.compare_digest(candidate, user["password_hash"]):
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Неверная почта или пароль"})
                return
            token, _ = self.create_session(db, user["id"])
        self.send_json(
            HTTPStatus.OK,
            {"user": public_user(user), "shops": self.user_shops(user["id"])},
            self.session_cookie(token, SESSION_DAYS * 24 * 60 * 60),
        )

    def logout(self) -> None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            pass
        morsel = cookie.get(SESSION_COOKIE)
        if morsel:
            token_hash = hashlib.sha256(morsel.value.encode("utf-8")).hexdigest()
            with connect_db() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
        self.send_json(HTTPStatus.OK, {"ok": True}, self.session_cookie("", 0))

    def create_shop(self, data: dict[str, object]) -> None:
        user = self.require_user()
        if user is None:
            return
        try:
            shop = clean_shop(data)
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(error)})
            return
        shop_id = str(uuid.uuid4())
        now = int(time.time())
        with connect_db() as db:
            db.execute(
                "INSERT INTO shops(id, owner_id, data_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (shop_id, user["id"], json.dumps(shop, ensure_ascii=False), now, now),
            )
        self.send_json(HTTPStatus.CREATED, {"shop": {"id": shop_id, **shop}})

    def import_shops(self, data: dict[str, object]) -> None:
        user = self.require_user()
        if user is None:
            return
        raw_shops = data.get("shops")
        if not isinstance(raw_shops, list) or len(raw_shops) > 20:
            raise ValueError("Можно перенести не более 20 магазинов за раз")
        now = int(time.time())
        imported = []
        with connect_db() as db:
            existing_count = db.execute("SELECT COUNT(*) FROM shops WHERE owner_id = ?", (user["id"],)).fetchone()[0]
            if existing_count:
                self.send_json(HTTPStatus.CONFLICT, {"error": "Перенос доступен, пока в аккаунте нет магазинов"})
                return
            for raw_shop in raw_shops:
                shop = clean_shop(raw_shop)
                source_id = clean_text(raw_shop.get("id") if isinstance(raw_shop, dict) else "", 100)
                shop_id = str(uuid.uuid4())
                db.execute(
                    "INSERT INTO shops(id, owner_id, source_id, data_json, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (shop_id, user["id"], source_id or None, json.dumps(shop, ensure_ascii=False), now, now),
                )
                imported.append({"id": shop_id, **shop})
        self.send_json(HTTPStatus.CREATED, {"shops": imported})

    def serve_static(self, path: str) -> None:
        relative = unquote(path).lstrip("/") or "index.html"
        if relative not in {"index.html", "app.js", "styles.css"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        target = ROOT / relative
        content = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if content_type.startswith(("text/", "application/javascript")):
            content_type += "; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(content)

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        if str(self.path).startswith("/api/"):
            self.send_json(code, {"error": message or HTTPStatus(code).phrase})
        else:
            super().send_error(code, message, explain)


def main() -> None:
    initialize_db()
    server = ThreadingHTTPServer((HOST, PORT), ShopHandler)
    print(f"Конструктор запущен: http://{HOST}:{PORT}")
    print(f"База данных: {DATABASE}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
