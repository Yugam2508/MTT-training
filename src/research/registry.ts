/** Every hero policy the satellite research can run, by key. */
import { chipNash, fieldReg, seatEV, seatVsChip, type HeroPolicy } from './policies';
import { exploitOracle, exploitRead } from './exploit';

export const POLICIES: Record<string, HeroPolicy> = { chipNash, fieldReg, seatEV, seatVsChip, exploitOracle, exploitRead };
