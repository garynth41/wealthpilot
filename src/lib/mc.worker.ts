// Web worker: runs the Monte Carlo simulation off the main thread. Message in: { balance, inputs, runs, seed } → message out: MonteCarlo result.
import { monteCarlo } from './retirement'
import type { RetirementInputs } from '../app/data/types'
self.onmessage = (e: MessageEvent<{ balance: number; inputs: RetirementInputs; runs: number; seed: number }>) => { const { balance, inputs, runs, seed } = e.data; const r = monteCarlo(balance, inputs, runs, seed); (self as unknown as Worker).postMessage(r) }
