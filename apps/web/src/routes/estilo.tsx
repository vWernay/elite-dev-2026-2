import {
  Alert,
  Badge,
  Button,
  Grid,
  Group,
  NumberInput,
  Paper,
  PasswordInput,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core"
import {
  IconAlertCircle,
  IconCheck,
  IconInfoCircle,
  IconSearch,
} from "@tabler/icons-react"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { EmptyState } from "../components/EmptyState"
import { LotCard, type LotCardData } from "../components/LotCard"
import { Money } from "../components/Money"
import { PageHeader } from "../components/PageHeader"
import { StatusBadge } from "../components/StatusBadge"
import { bidStateColor } from "../theme"

// Página de referência do tema. Só existe em desenvolvimento.
// Autorado pelo Claude. Agilidade na criação do guia de estilo.
export const Route = createFileRoute("/estilo")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw redirect({ to: "/" })
  },
  component: StyleGuide,
})

const image =
  "https://cards.scryfall.io/normal/front/6/9/6904ea20-e504-47da-95a0-08739fdde260.jpg"

const now = Date.now()
const hours = (n: number) => new Date(now + n * 3_600_000).toISOString()

const sample: LotCardData[] = [
  {
    title: "Delver of Secrets // Insectile Aberration",
    imageUrl: image,
    status: "live",
    set: "Innistrad",
    rarity: "common",
    startingBidCents: 10_000,
    currentBidCents: 12_500,
    bidCount: 3,
    startsAt: hours(-2),
    endsAt: hours(5.25),
  },
  {
    title: "Black Lotus",
    imageUrl: image,
    status: "scheduled",
    set: "Alpha",
    rarity: "rare",
    startingBidCents: 5_000_000,
    currentBidCents: null,
    bidCount: 0,
    startsAt: hours(30),
    endsAt: hours(54),
  },
  {
    title: "Lightning Bolt",
    imageUrl: image,
    status: "ended",
    set: "Beta",
    rarity: "common",
    startingBidCents: 8_000,
    currentBidCents: 21_000,
    bidCount: 1,
    startsAt: hours(-30),
    endsAt: hours(-6),
  },
]

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <Stack gap="sm">
      <Title order={3}>{title}</Title>
      {children}
    </Stack>
  )
}

function StyleGuide() {
  return (
    <Stack gap="xl">
      <PageHeader
        title="Guia de estilo"
        description="Referência visual do tema. Aparece só em desenvolvimento."
        actions={<Button>Ação principal</Button>}
      />

      <Section title="Tipografia">
        <Title order={1}>Título 1: vitrine de lotes</Title>
        <Title order={2}>Título 2: sala do lote</Title>
        <Title order={3}>Título 3: histórico de lances</Title>
        <Text>
          Texto normal. Os valores são simulados e não há cobrança real.
        </Text>
        <Text c="dimmed" size="sm">
          Texto secundário, para datas, rótulos e explicações curtas.
        </Text>
      </Section>

      <Section title="Botões">
        <Group>
          <Button>Dar lance</Button>
          <Button variant="light">Secundário</Button>
          <Button variant="default">Neutro</Button>
          <Button variant="subtle">Discreto</Button>
          <Button color="red" variant="light">
            Cancelar lote
          </Button>
          <Button loading>Enviando</Button>
          <Button disabled>Desativado</Button>
        </Group>
      </Section>

      <Section title="Situações e cores">
        <Group>
          <StatusBadge status="live" />
          <StatusBadge status="scheduled" />
          <StatusBadge status="ended" />
          <StatusBadge status="cancelled" />
        </Group>
        <Group>
          <Badge color={bidStateColor.leading}>Você está ganhando</Badge>
          <Badge color={bidStateColor.outbid}>Você foi superado</Badge>
          <Badge color={bidStateColor.won}>Arrematado</Badge>
          <Badge color={bidStateColor.lost}>Perdido</Badge>
        </Group>
        <Stack gap="xs">
          <Alert
            color="green"
            icon={<IconCheck size={18} />}
            title="Lance aceito"
          >
            Seu lance de R$ 125,00 está na frente.
          </Alert>
          <Alert
            color="orange"
            icon={<IconInfoCircle size={18} />}
            title="Você foi superado"
          >
            Outro licitante cobriu seu lance. O valor voltou ao seu saldo
            disponível.
          </Alert>
          <Alert
            color="red"
            icon={<IconAlertCircle size={18} />}
            title="Lance recusado"
          >
            O lance mínimo agora é R$ 130,00.
          </Alert>
        </Stack>
      </Section>

      <Section title="Valores">
        <Group gap="xl">
          <Money cents={12_500} fz="xl" fw={700} />
          <Money cents={5_000_000} fz="xl" fw={700} />
          <Money cents={99} />
        </Group>
      </Section>

      <Section title="Formulário">
        <Paper p="md" maw={420}>
          <Stack>
            <TextInput label="E-mail" placeholder="voce@exemplo.com" />
            <PasswordInput label="Senha" placeholder="Mínimo de 8 caracteres" />
            <NumberInput
              label="Valor do lance"
              prefix="R$ "
              decimalScale={2}
              fixedDecimalScale
            />
            <Select
              label="Perfil"
              data={["Licitante", "Leiloeiro"]}
              defaultValue="Licitante"
            />
            <TextInput
              label="Buscar"
              leftSection={<IconSearch size={16} />}
              placeholder="Nome ou coleção"
            />
            <TextInput label="Com erro" error="Informe um valor válido" />
          </Stack>
        </Paper>
      </Section>

      <Section title="Card de lote">
        <Grid>
          {sample.map((lot) => (
            <Grid.Col key={lot.title} span={{ base: 12, xs: 6, md: 4 }}>
              <LotCard
                lot={lot}
                now={now}
                action={
                  <Button variant="light" fullWidth>
                    Ver lote
                  </Button>
                }
              />
            </Grid.Col>
          ))}
        </Grid>
      </Section>

      <Section title="Tabela">
        <Paper>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>#</Table.Th>
                <Table.Th>Licitante</Table.Th>
                <Table.Th ta="right">Valor</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {[3, 2, 1].map((seq) => (
                <Table.Tr key={seq}>
                  <Table.Td>{seq}</Table.Td>
                  <Table.Td>Licitante #a3f9c{seq}</Table.Td>
                  <Table.Td ta="right">
                    <Money cents={10_000 + seq * 500} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      </Section>

      <Section title="Estado vazio">
        <Paper>
          <EmptyState
            icon={IconSearch}
            title="Nenhum lote encontrado"
            description="Tente outra busca ou volte mais tarde."
            action={<Button variant="default">Limpar busca</Button>}
          />
        </Paper>
      </Section>
    </Stack>
  )
}
