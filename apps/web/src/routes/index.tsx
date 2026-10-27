import {
  Button,
  CloseButton,
  Group,
  Pagination,
  Paper,
  Tabs,
  TextInput,
} from "@mantine/core"
import { useDebouncedCallback } from "@mantine/hooks"
import { IconGavel, IconSearch } from "@tabler/icons-react"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { z } from "zod"
import { useGetApiLots } from "../api/generated/api"
import { EmptyState } from "../components/EmptyState"
import { ErrorState } from "../components/ErrorState"
import { LotsGrid, LotsSkeleton } from "../components/lots/LotsGrid"
import { PageHeader } from "../components/PageHeader"
import { useNow } from "../lib/useNow"

const PAGE_SIZE = 12

// Aba, busca e página ficam na URL. Assim dar para compartilhar e o voltar funciona.
// Tudo sendo opcional. O padrão (ao vivo, página 1) deixa a URL limpa.
const searchSchema = z.object({
  status: z.enum(["live", "scheduled", "ended"]).optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  page: z.number().int().min(1).optional().catch(undefined),
})

export const Route = createFileRoute("/")({
  validateSearch: searchSchema,
  component: Showcase,
})

type Search = z.infer<typeof searchSchema>

// Os padrões (ao vivo, página 1) saem da URL para ela ficar limpa
const normalize = (s: Search): Search => ({
  status: s.status === "live" ? undefined : s.status,
  q: s.q || undefined,
  page: s.page === 1 ? undefined : s.page,
})

const tabs = {
  live: "Ao vivo",
  scheduled: "Agendados",
  ended: "Encerrados",
} as const

const emptyTitle = {
  live: "Nenhum lote ao vivo agora",
  scheduled: "Nenhum lote agendado",
  ended: "Nenhum lote encerrado ainda",
} as const

function Showcase() {
  const { status = "live", q, page = 1 } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [text, setText] = useState(q ?? "")

  const lots = useGetApiLots(
    { status, q, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
    // Os lotes abertos mudam a cada lance; os encerrados não
    { query: { refetchInterval: status === "ended" ? false : 15_000 } },
  )
  const now = useNow(status === "ended" ? null : 1_000)

  const go = (change: Search, replace = false) =>
    navigate({ search: (prev) => normalize({ ...prev, ...change }), replace })

  const pushQuery = useDebouncedCallback((value: string) => {
    go({ q: value.trim() || undefined, page: 1 }, true)
  }, 350)

  const items = lots.data?.data.items ?? []
  const total = lots.data?.data.total ?? 0
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Quando um lote ao vivo vence, recarrega na hora em vez de esperar o próximo ciclo
  const hasExpired =
    status === "live" && items.some((lot) => Date.parse(lot.endsAt) <= now)
  // biome-ignore lint/correctness/useExhaustiveDependencies: só quando passa a existir um vencido
  useEffect(() => {
    if (hasExpired) lots.refetch()
  }, [hasExpired])

  // Se a página pedida deixou de existir (lotes saíram da lista), volta à primeira
  useEffect(() => {
    if (lots.isSuccess && items.length === 0 && page > 1) {
      navigate({
        search: (prev) => normalize({ ...prev, page: 1 }),
        replace: true,
      })
    }
  }, [lots.isSuccess, items.length, page, navigate])

  const clearSearch = () => {
    setText("")
    go({ q: undefined, page: 1 })
  }

  return (
    <>
      <PageHeader
        title="Vitrine de lotes"
        description="Cartas de Magic: The Gathering em leilão. Os valores são simulados."
      />

      <Group justify="space-between" align="flex-end" mb="lg" gap="md">
        <Tabs
          value={status}
          onChange={(value) =>
            go({ status: value as keyof typeof tabs, page: 1 })
          }
        >
          <Tabs.List>
            {Object.entries(tabs).map(([value, label]) => (
              <Tabs.Tab key={value} value={value}>
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs>

        <TextInput
          aria-label="Buscar lotes"
          placeholder="Buscar por nome ou coleção"
          leftSection={<IconSearch size={16} />}
          rightSection={
            text ? (
              <CloseButton
                size="sm"
                aria-label="Limpar busca"
                onClick={clearSearch}
              />
            ) : null
          }
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value)
            pushQuery(event.currentTarget.value)
          }}
          w={{ base: "100%", sm: 320 }}
        />
      </Group>

      {lots.isPending ? (
        <LotsSkeleton />
      ) : lots.isError ? (
        <ErrorState error={lots.error} onRetry={() => lots.refetch()} />
      ) : items.length === 0 ? (
        <Paper>
          <EmptyState
            icon={q ? IconSearch : IconGavel}
            title={q ? "Nenhum lote encontrado" : emptyTitle[status]}
            description={
              q
                ? `Nada para "${q}" em ${tabs[status].toLowerCase()}. Tente outra busca.`
                : "Veja as outras abas ou volte mais tarde."
            }
            action={
              q ? (
                <Button variant="default" onClick={clearSearch}>
                  Limpar busca
                </Button>
              ) : undefined
            }
          />
        </Paper>
      ) : (
        <>
          <LotsGrid items={items} now={now} />
          {pages > 1 && (
            <Group justify="center" mt="xl">
              <Pagination
                total={pages}
                value={page}
                onChange={(value) => {
                  go({ page: value })
                  window.scrollTo({ top: 0 })
                }}
              />
            </Group>
          )}
        </>
      )}
    </>
  )
}
