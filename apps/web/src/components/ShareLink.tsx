import { ActionIcon, CopyButton, TextInput, Tooltip } from "@mantine/core"
import { IconCheck, IconCopy } from "@tabler/icons-react"

// Campo só de leitura com o endereço completo e um botão de copiar.
export function ShareLink({ path, label }: { path: string; label: string }) {
  const url = `${window.location.origin}${path}`

  return (
    <TextInput
      label={label}
      value={url}
      readOnly
      onFocus={(event) => event.currentTarget.select()}
      rightSection={
        <CopyButton value={url} timeout={2000}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? "Copiado" : "Copiar link"} withArrow>
              <ActionIcon
                variant="subtle"
                color={copied ? "green" : "gray"}
                onClick={copy}
                aria-label="Copiar link"
              >
                {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      }
    />
  )
}
