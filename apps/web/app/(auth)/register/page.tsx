'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signUp } from '@boilerplate/auth'
import { Button, Input, Label, Card, CardHeader, CardTitle, CardContent } from '@boilerplate/ui'

export default function RegisterPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const data = new FormData(e.currentTarget)
    const result = await signUp({
      email: data.get('email') as string,
      password: data.get('password') as string,
      name: data.get('name') as string,
    })

    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }

    router.push('/dashboard')
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Criar conta</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input id="name" name="name" type="text" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input id="password" name="password" type="password" required minLength={6} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Criando...' : 'Criar conta'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
