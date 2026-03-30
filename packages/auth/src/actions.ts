'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from './server'
import type { SignUpParams, SignInParams, ResetPasswordParams, AuthResult, AuthUser } from './types'

export async function signUp(params: SignUpParams): Promise<AuthResult<AuthUser>> {
  const supabase = createServerSupabaseClient()

  const { data, error } = await supabase.auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      data: { name: params.name },
    },
  })

  if (error) return { data: null, error: error.message }
  if (!data.user) return { data: null, error: 'Usuário não criado' }

  return {
    data: {
      id: data.user.id,
      email: data.user.email!,
      name: data.user.user_metadata?.name,
      createdAt: data.user.created_at,
    },
    error: null,
  }
}

export async function signIn(params: SignInParams): Promise<AuthResult> {
  const supabase = createServerSupabaseClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: params.email,
    password: params.password,
  })

  if (error) return { data: null, error: error.message }

  revalidatePath('/', 'layout')
  return { data: null, error: null }
}

export async function signOut(): Promise<void> {
  const supabase = createServerSupabaseClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function resetPassword(params: ResetPasswordParams): Promise<AuthResult> {
  const supabase = createServerSupabaseClient()

  const { error } = await supabase.auth.resetPasswordForEmail(params.email, {
    redirectTo: params.redirectTo ?? `${process.env.NEXT_PUBLIC_APP_URL}/update-password`,
  })

  if (error) return { data: null, error: error.message }
  return { data: null, error: null }
}

export async function updatePassword(password: string): Promise<AuthResult> {
  const supabase = createServerSupabaseClient()

  const { error } = await supabase.auth.updateUser({ password })

  if (error) return { data: null, error: error.message }

  revalidatePath('/', 'layout')
  return { data: null, error: null }
}

export async function getUser(): Promise<AuthUser | null> {
  const supabase = createServerSupabaseClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  return {
    id: user.id,
    email: user.email!,
    name: user.user_metadata?.name,
    avatarUrl: user.user_metadata?.avatar_url,
    createdAt: user.created_at,
  }
}
