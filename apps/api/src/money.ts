const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
})

export const formatCents = (cents: number) => brl.format(cents / 100)
