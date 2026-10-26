import { Alert, Button, PasswordInput, Stack, TextInput } from "@mantine/core"
import { useForm } from "@mantine/form"
import { IconAlertCircle } from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { zod4Resolver } from "mantine-form-zod-resolver"
import { useState } from "react"
import { z } from "zod"
import { usePostApiAuthLogin } from "../api/generated/api"
import { requireGuest, safeRedirect, setSession } from "../auth/session"
import { AuthCard } from "../components/auth/AuthCard"
import { RouterAnchor } from "../components/RouterAnchor"
import { applyApiError } from "../lib/form"

const schema = z.object({
  email: z.email("Informe um e-mail válido"),
  password: z.string().min(1, "Informe a senha"),
})

export const Route = createFileRoute("/entrar")({
  validateSearch: z.object({
    redirect: z.string().optional().catch(undefined),
  }),
  beforeLoad: requireGuest,
  component: LoginPage,
})

function LoginPage() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const login = usePostApiAuthLogin()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    mode: "uncontrolled",
    initialValues: { email: "", password: "" },
    validate: zod4Resolver(schema),
  })

  const submit = form.onSubmit((values) => {
    setFormError(null)
    login.mutate(
      { data: values },
      {
        onSuccess: (res) => {
          setSession(queryClient, res.data)
          router.history.push(safeRedirect(redirect))
        },
        onError: (err) => setFormError(applyApiError(err, form.setFieldError)),
      },
    )
  })

  return (
    <AuthCard
      title="Entrar"
      subtitle={
        <>
          Ainda não tem conta?{" "}
          <RouterAnchor to="/cadastro" search={{ redirect }} size="sm">
            Criar conta
          </RouterAnchor>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <Stack>
          {formError && (
            <Alert color="red" icon={<IconAlertCircle size={18} />}>
              {formError}
            </Alert>
          )}
          <TextInput
            label="E-mail"
            placeholder="voce@exemplo.com"
            autoComplete="email"
            required
            key={form.key("email")}
            {...form.getInputProps("email")}
          />
          <PasswordInput
            label="Senha"
            autoComplete="current-password"
            required
            key={form.key("password")}
            {...form.getInputProps("password")}
          />
          <Button type="submit" fullWidth loading={login.isPending}>
            Entrar
          </Button>
        </Stack>
      </form>
    </AuthCard>
  )
}
