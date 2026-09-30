import { standardChart } from './pushfold';
import { rangePercent } from '../engine/ranges';
import { classFromName } from '../engine/combos';
import { eqClassVsClass, equityVsRandom } from '../engine/preflopMatrix';
import { icmExact, icmBatch } from './icm';
import { payoutStructure } from './payouts';

describe('preflop matrix', () => {
  it('has sensible values', () => {
    const aa = classFromName('AA'), kk = classFromName('KK'), ako = classFromName('AKo'), qq = classFromName('QQ');
    expect(eqClassVsClass(aa, kk)).toBeGreaterThan(0.80);
    expect(eqClassVsClass(aa, kk)).toBeLessThan(0.84);
    expect(eqClassVsClass(ako, qq)).toBeGreaterThan(0.41);
    expect(eqClassVsClass(ako, qq)).toBeLessThan(0.45);
    const vr = equityVsRandom();
    expect(vr[aa]).toBeGreaterThan(0.84);
    expect(vr[classFromName('72o')]).toBeLessThan(0.36);
  });
});

describe('push/fold solver', () => {
  it('HU 10bb no ante resembles known Nash (SB pushes ~58%, BB calls ~37%)', () => {
    const r = standardChart({ stackBB: 10, playersBehind: 1, anteBB: 0 });
    const push = rangePercent(r.push);
    const call = rangePercent(r.calls[0]);
    expect(push).toBeGreaterThan(50);
    expect(push).toBeLessThan(66);
    expect(call).toBeGreaterThan(30);
    expect(call).toBeLessThan(44);
  });
  it('UTG at 10bb pushes a tight range', () => {
    const r = standardChart({ stackBB: 10, playersBehind: 8, anteBB: 1 });
    const push = rangePercent(r.push);
    expect(push).toBeGreaterThan(8);
    expect(push).toBeLessThan(25);
    expect(r.push[classFromName('AA')]).toBe(1);
    expect(r.push[classFromName('72o')]).toBe(0);
  });
});

describe('ICM', () => {
  it('equal stacks get equal equity', () => {
    const e = icmExact([100, 100, 100], [50, 30, 20]);
    e.forEach((x) => expect(x).toBeCloseTo(100 / 3, 6));
  });
  it('matches known 3-player example', () => {
    // stacks 50/30/20, payouts 50/30/20 (classic example)
    const e = icmExact([50, 30, 20], [50, 30, 20]);
    expect(e[0]).toBeCloseTo(38.39, 1);
    expect(e[2]).toBeCloseTo(28.857, 2);
    expect(e.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });
  it('monte carlo agrees with exact', () => {
    const stacks = Array.from({ length: 40 }, (_, i) => 1000 + i * 137);
    const pay = payoutStructure(40, 10).concat(new Array(40).fill(0)).slice(0, 40);
    const mc = icmBatch([stacks], pay, 20000)[0];
    const total = mc.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(400, 0);
    // bigger stacks have more equity
    expect(mc[39]).toBeGreaterThan(mc[0]);
  });
  it('busted players take bottom places', () => {
    const e = icmExact([100, 0, 100], [50, 30, 20]);
    expect(e[1]).toBeCloseTo(20, 6);
    expect(e[0]).toBeCloseTo(40, 6);
  });
});
