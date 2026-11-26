import 'koa';

declare module 'koa' {
  interface DefaultState {
    user?: {
      id: string;
      email: string;
      role: 'platform_admin' | 'shop_owner' | 'shop_manager' | 'customer';
    };
  }
}
