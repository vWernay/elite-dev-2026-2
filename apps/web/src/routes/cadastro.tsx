import {
  Alert,
  Button,
  PasswordInput,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
} from "@mantine/core"
import { useForm } from "@mantine/form"
import { IconAlertCircle } from "@tabler/icons-react"
import { useQueryClient } from "@tanstack/react-query"
import { createFileRoute, useRouter } from "@tanstack/react-router"
import { zod4Resolver } from "mantine-form-zod-resolver"
import { useState } from "react"
import { z } from "zod"
import { usePostApiAuthRegister } from "../api/generated/api"
import { requireGuest, safeRedirect, setSession } from "../auth/session"
import { AuthCard } from "../components/auth/AuthCard"
import { RouterAnchor } from "../components/RouterAnchor"
import { applyApiError } from "../lib/form"

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Informe seu nome")
    .max(100, "Máximo de 100 caracteres"),
  email: z.email("Informe um e-mail válido"),
  password: z
    .string()
    .min(8, "A senha precisa ter pelo menos 8 caracteres")
    .max(128, "Máximo de 128 caracteres"),
  role: z.enum(["bidder", "auctioneer"]),
})

const roleHelp = {
  bidder: "Deposita saldo, acompanha os lotes ao vivo e dá lances.",
  auctioneer: "Cria lotes a partir de cartas e acompanha os resultados.",
} as const

export const Route = createFileRoute("/cadastro")({
  validateSearch: z.object({
    redirect: z.string().optional().catch(undefined),
  }),
  beforeLoad: requireGuest,
  component: RegisterPage,
})

function RegisterPage() {
  const { redirect } = Route.useSearch()
  const router = useRouter()
  const queryClient = useQueryClient()
  const register = usePostApiAuthRegister()
  const [formError, setFormError] = useState<string | null>(null)

  const form = useForm({
    mode: "controlled",
    initialValues: {
      name: "",
      email: "",
      password: "",
      role: "bidder" as "bidder" | "auctioneer",
    },
    validate: zod4Resolver(schema),
  })

  const submit = form.onSubmit((values) => {
    setFormError(null)
    register.mutate(
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
      title="Criar conta"
      subtitle={
        <>
          Já tem conta?{" "}
          <RouterAnchor to="/entrar" search={{ redirect }} size="sm">
            Entrar
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
          <div>
            <Text size="sm" fw={500} mb={4}>
              Como você vai usar a casa de leilões?
            </Text>
            <SegmentedControl
              fullWidth
              data={[
                { value: "bidder", label: "Licitante" },
                { value: "auctioneer", label: "Leiloeiro" },
              ]}
              {...form.getInputProps("role")}
            />
            <Text size="xs" c="dimmed" mt={6}>
              {roleHelp[form.values.role]}
            </Text>
          </div>
          <TextInput
            label="Nome"
            autoComplete="name"
            required
            {...form.getInputProps("name")}
          />
          <TextInput
            label="E-mail"
            placeholder="voce@exemplo.com"
            autoComplete="email"
            required
            {...form.getInputProps("email")}
          />
          <PasswordInput
            label="Senha"
            description="Mínimo de 8 caracteres"
            autoComplete="new-password"
            required
            {...form.getInputProps("password")}
          />
          <Button type="submit" fullWidth loading={register.isPending}>
            Criar conta
          </Button>
        </Stack>
      </form>
    </AuthCard>
  )
}
