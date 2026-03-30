import { redirect } from 'next/navigation'
import { getUser, signOut } from '@boilerplate/auth'
import { Button, Card, CardHeader, CardTitle, CardContent } from '@boilerplate/ui'

export default async function DashboardPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  return (
    <div className="container mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <form action={signOut}>
          <Button variant="outline" type="submit">Sair</Button>
        </form>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Bem-vindo, {user.name ?? user.email}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Seu painel está pronto.</p>
        </CardContent>
      </Card>
    </div>
  )
}
