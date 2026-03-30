export type { User, Session } from '@supabase/supabase-js'

export interface AuthUser {
  id: string
  email: string
  name?: string
  avatarUrl?: string
  createdAt: string
}

export interface AuthSession {
  user: AuthUser
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export interface SignUpParams {
  email: string
  password: string
  name?: string
}

export interface SignInParams {
  email: string
  password: string
}

export interface ResetPasswordParams {
  email: string
  redirectTo?: string
}

export interface UpdatePasswordParams {
  password: string
}

export interface AuthResult<T = void> {
  data: T | null
  error: string | null
}
