//src\app\store\selectors\selectors.interactions\friends\vm-selectors\all.rich.ts
import { createSelector } from '@ngrx/store';
import { selectInboundRequests } from '../inbound.selectors';
import { selectOutboundRequests } from '../outbound.selectors';
import { InboundRequestRichVM, selectInboundRequestsRichVM } from './inbound.rich';
import { OutboundRequestRichVM, selectOutboundRequestsRichVM } from './outbound.rich';

export type AllRequestsRichVM = {
  inbound: InboundRequestRichVM[];
  outbound: OutboundRequestRichVM[];
};

export const selectAllRequestsRichVM = createSelector(
  selectInboundRequestsRichVM,
  selectOutboundRequestsRichVM,
  (inb, outb): AllRequestsRichVM => ({
    inbound: inb ?? [],
    outbound: outb ?? [],
  })
);

export const selectAllRequestsCount = createSelector(
  selectInboundRequests,
  selectOutboundRequests,
  (a, b) => (a?.length ?? 0) + (b?.length ?? 0)
);
