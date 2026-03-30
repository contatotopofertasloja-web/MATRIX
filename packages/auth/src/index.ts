export { createClient } from './client'
export { createServerSupabaseClient, createServiceRoleClient } from './server'
export { updateSession } from './middleware'
export { signUp, signIn, signOut, resetPassword, updatePassword, getUser } from './actions'
export type {
  AuthUser,
  AuthSession,
  SignUpParams,
  SignInParams,
  ResetPasswordParams,
  UpdatePasswordParams,
  AuthResult,
} from './types'
