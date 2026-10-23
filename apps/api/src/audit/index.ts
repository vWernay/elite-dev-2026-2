import { env } from "../env.js"
import { createChain } from "./chain.js"

export const chain = createChain(env.AUDIT_SECRET)
