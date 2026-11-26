import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export type UserRole = 'platform_admin' | 'shop_owner' | 'shop_manager' | 'customer';
export interface User {
  id: string;
  email: string;
  role: UserRole;
  firstName?: string;
  lastName?: string;
}

interface AuthState {
  accessToken: string | null;
  user: User | null;
}

const initialState: AuthState = { accessToken: null, user: null };

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    signedIn(state, action: PayloadAction<{ accessToken: string; user: User }>) {
      state.accessToken = action.payload.accessToken;
      state.user = action.payload.user;
      sessionStorage.setItem('accessToken', action.payload.accessToken);
    },
    refreshed(state, action: PayloadAction<string>) {
      state.accessToken = action.payload;
      sessionStorage.setItem('accessToken', action.payload);
    },
    signedOut(state) {
      state.accessToken = null;
      state.user = null;
      sessionStorage.removeItem('accessToken');
    },
  },
});

export const { signedIn, refreshed, signedOut } = authSlice.actions;
export default authSlice.reducer;
