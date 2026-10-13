import {it,expect} from 'vitest';
import {acquireOriginalImageLease,originalMemorySnapshot} from './imageMemoryBudget';
it('accounts true 4K pixels, shares a lease, bounds originals and releases idempotently',()=>{
  const a=acquireOriginalImageLease('a',3840,2160)!;
  const shared=acquireOriginalImageLease('a',3840,2160)!;
  const b=acquireOriginalImageLease('b',3840,2160)!;
  const c=acquireOriginalImageLease('c',3840,2160)!;
  expect(acquireOriginalImageLease('d',3840,2160)).toBeNull();
  expect(originalMemorySnapshot().bytes).toBe(3840*2160*4*3);
  a();a();expect(originalMemorySnapshot().count).toBe(3);
  shared();b();c();expect(originalMemorySnapshot().count).toBe(0);
});
